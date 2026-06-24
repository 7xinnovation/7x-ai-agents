import type Anthropic from "@anthropic-ai/sdk";
import { getDb, agentIntegrations } from "@dialog/db";
import { and, eq, desc } from "drizzle-orm";
import type { ApiOperation } from "./openapi";
import { encryptSecret, decryptSecret, isEncrypted } from "./crypto";

export type EnvKey = "staging" | "production";

export type AuthType = "none" | "bearer" | "apiKey" | "uaepass_test" | "uaepass_live";

export interface EnvSpec {
  specUrl: string;
  baseUrl: string;
  // uaepass_test: use the stored token (authValue) as the session bearer.
  // uaepass_live: use the UAE PASS session token forwarded by the embedding site.
  authType: AuthType;
  authValue: string | null;
  authHeader: string | null;
  operations: ApiOperation[];
}

export interface IntegrationRow {
  id: string;
  name: string;
  enabled: boolean;
  environments: Partial<Record<EnvKey, EnvSpec>>;
}

export async function listIntegrations(agentId: string): Promise<IntegrationRow[]> {
  const rows = await getDb()
    .select()
    .from(agentIntegrations)
    .where(eq(agentIntegrations.agentId, agentId))
    .orderBy(desc(agentIntegrations.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    environments: (r.environments ?? {}) as Partial<Record<EnvKey, EnvSpec>>,
  }));
}

/** Mask an integration's stored secrets before sending to the admin UI (never leak tokens). */
export function maskIntegrations(rows: IntegrationRow[]): IntegrationRow[] {
  return rows.map((r) => ({
    ...r,
    environments: Object.fromEntries(
      Object.entries(r.environments).map(([k, spec]) => [
        k,
        spec ? { ...spec, authValue: spec.authValue ? "••••••••" : null } : spec,
      ])
    ) as IntegrationRow["environments"],
  }));
}

/** Add or replace one environment's spec on an integration (matched by name). */
export async function upsertEnvironment(agentId: string, name: string, env: EnvKey, spec: EnvSpec) {
  const db = getDb();
  const existing = (await listIntegrations(agentId)).find((i) => i.name.toLowerCase() === name.toLowerCase());
  // Encrypt the secret at rest (PRD: encryption at rest for integration tokens).
  // A masked placeholder means "keep the existing secret" (admin re-save).
  if (spec.authValue === "••••••••") {
    spec = { ...spec, authValue: existing?.environments[env]?.authValue ?? null };
  } else {
    spec = { ...spec, authValue: encryptSecret(spec.authValue) };
  }
  if (existing) {
    const environments = { ...existing.environments, [env]: spec };
    await db.update(agentIntegrations).set({ environments }).where(eq(agentIntegrations.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(agentIntegrations)
    .values({ agentId, name, environments: { [env]: spec }, enabled: true })
    .returning();
  return row!.id;
}

export async function setIntegrationEnabled(agentId: string, id: string, enabled: boolean) {
  await getDb().update(agentIntegrations).set({ enabled }).where(and(eq(agentIntegrations.id, id), eq(agentIntegrations.agentId, agentId)));
}

export async function deleteIntegration(agentId: string, id: string) {
  await getDb().delete(agentIntegrations).where(and(eq(agentIntegrations.id, id), eq(agentIntegrations.agentId, agentId)));
}

/** Remove a single environment from an integration (deletes the integration if none left). */
export async function deleteEnvironment(agentId: string, id: string, env: EnvKey) {
  const it = (await listIntegrations(agentId)).find((i) => i.id === id);
  if (!it) return;
  const environments = { ...it.environments };
  delete environments[env];
  if (Object.keys(environments).length === 0) return deleteIntegration(agentId, id);
  await getDb().update(agentIntegrations).set({ environments }).where(and(eq(agentIntegrations.id, id), eq(agentIntegrations.agentId, agentId)));
}

const prefix = (name: string) => name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14).toLowerCase() || "api";

/**
 * Login/token operations are callable WITHOUT an existing session — they are how
 * a session is obtained (e.g. UAE PASS-independent OTP: passwordLessToken →
 * verifyPasswordLessToken). Everything else is "protected" and needs a session.
 */
function isAuthOperation(op: ApiOperation): boolean {
  return /(^|\/)(token|login|sign-?in|authenticate|auth|otp|passwordless)/i.test(op.path) || /token|login|otp|passwordless/i.test(op.toolName);
}

/** Best-effort extraction of a session/bearer token from a JSON response body. */
export function extractSessionToken(body: string): string | null {
  let json: unknown;
  try { json = JSON.parse(body); } catch { return null; }
  const KEY = /(access_?token|session_?token|id_?token|auth_?token|bearer|^token$|jwt)/i;
  let found: string | null = null;
  const walk = (v: unknown, depth: number) => {
    if (found || depth > 4 || v === null || typeof v !== "object") return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (found) return;
      if (typeof val === "string" && KEY.test(k) && val.length >= 20) { found = val; return; }
      if (typeof val === "object") walk(val, depth + 1);
    }
  };
  walk(json, 0);
  return found;
}

/**
 * Build Claude tools + executor for the agent's ACTIVE environment. Each enabled
 * integration that has a spec for `activeEnv` contributes its operations.
 *
 * Session tokens (auth):
 *  - `uaePassToken`  : a live UAE PASS session forwarded by the embedding site.
 *  - `sessionToken`  : a token already obtained for THIS conversation (e.g. via the
 *                      OTP/passwordless flow on a previous turn), persisted on the
 *                      conversation.
 *  - captured at runtime: if a login op returns a token mid-turn, it is captured and
 *                      reused for subsequent protected calls; `getCapturedToken()`
 *                      lets the caller persist it for later turns.
 */
export async function buildApiTools(
  agentId: string,
  activeEnv: EnvKey,
  opts: { uaePassToken?: string; sessionToken?: string } = {}
): Promise<{
  tools: Anthropic.Tool[];
  exec: (toolName: string, input: Record<string, unknown>) => Promise<{ result: string; isError?: boolean }>;
  getCapturedToken: () => string | null;
}> {
  const integrations = (await listIntegrations(agentId)).filter((i) => i.enabled);
  const tools: Anthropic.Tool[] = [];
  const map = new Map<string, { spec: EnvSpec; op: ApiOperation }>();

  for (const intg of integrations) {
    const spec = intg.environments[activeEnv];
    if (!spec) continue; // no spec for the active environment
    const pfx = prefix(intg.name);
    for (const op of spec.operations) {
      const toolName = `${pfx}__${op.toolName}`.slice(0, 64);
      if (map.has(toolName)) continue;
      map.set(toolName, { spec, op });
      tools.push({
        name: toolName,
        description: `[${intg.name}] ${op.summary}`.slice(0, 380),
        input_schema: op.inputSchema as Anthropic.Tool["input_schema"],
      });
    }
  }

  // Runtime session token: a token captured this turn takes priority over one
  // persisted from a previous turn, which takes priority over the UAE PASS passthrough.
  let captured: string | null = null;
  const runtimeToken = () => captured ?? opts.sessionToken ?? opts.uaePassToken ?? undefined;

  const exec = async (toolName: string, input: Record<string, unknown>) => {
    const entry = map.get(toolName);
    if (!entry) return { result: `Unknown integration tool ${toolName}.`, isError: true };
    const liveSpec = isEncrypted(entry.spec.authValue)
      ? { ...entry.spec, authValue: decryptSecret(entry.spec.authValue) }
      : entry.spec;
    const res = await executeOperation(liveSpec, entry.op, input ?? {}, runtimeToken());
    // Capture a freshly-minted session token from a login/token op for reuse.
    if (!res.isError && isAuthOperation(entry.op)) {
      const body = res.result.slice(res.result.indexOf("\n") + 1);
      const tok = extractSessionToken(body);
      if (tok) captured = tok;
    }
    return res;
  };

  return { tools, exec, getCapturedToken: () => captured };
}

export async function executeOperation(
  spec: EnvSpec,
  op: ApiOperation,
  input: Record<string, unknown>,
  runtimeToken?: string
): Promise<{ result: string; isError?: boolean }> {
  try {
    const tokenAuth = spec.authType === "bearer" || spec.authType === "uaepass_test" || spec.authType === "uaepass_live";
    // Effective bearer: a runtime session (UAE PASS passthrough or OTP-minted token)
    // wins; otherwise fall back to a stored token (bearer / uaepass_test).
    const stored = spec.authType === "bearer" || spec.authType === "uaepass_test" ? spec.authValue : null;
    const bearer = runtimeToken ?? stored ?? null;

    const signInMsg =
      "This action needs the customer to be signed in, but no active session is available yet. " +
      (spec.authType === "uaepass_live"
        ? "Ask them to sign in with UAE PASS on the website, "
        : "Start the sign-in (one-time passcode) flow to obtain a session, ") +
      "or offer a callback. Do not invent a result.";

    // Pre-gate ONLY operations the spec explicitly marks as secured (and only when
    // we have no session and it isn't itself a login op). Guest/public endpoints —
    // and specs that declare no security at all — are NOT blocked here; the backend
    // decides via a 401/403, which we translate gracefully below.
    if (tokenAuth && !bearer && op.requiresAuth && !isAuthOperation(op)) {
      return { result: signInMsg, isError: true };
    }

    let path = op.path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = { Accept: "application/json" };

    for (const p of op.params) {
      const v = input[p.name];
      if (v === undefined || v === null || v === "") continue;
      if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
      else if (p.in === "query") query.set(p.name, String(v));
      else if (p.in === "header") headers[p.name] = String(v);
    }

    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    if (spec.authType === "apiKey" && spec.authValue) headers[spec.authHeader || "X-API-Key"] = spec.authValue;

    let body: string | undefined;
    if (op.hasBody && input.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(input.body);
    }

    const qs = query.toString();
    const url = `${spec.baseUrl}${path}${qs ? `?${qs}` : ""}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { method: op.method, headers, body, signal: ctrl.signal });
    clearTimeout(timer);

    // Backend says auth is required/insufficient — translate to guidance instead
    // of a raw 401/403 (the backend is the source of truth for what needs a session).
    if ((res.status === 401 || res.status === 403) && tokenAuth && !isAuthOperation(op)) {
      return {
        result: bearer
          ? "The customer's session was rejected (expired or invalid). Ask them to sign in again (one-time passcode) or offer a callback. Do not invent a result."
          : signInMsg,
        isError: true,
      };
    }

    const text = await res.text();
    const trimmed = text.length > 4000 ? text.slice(0, 4000) + "…(truncated)" : text;
    return { result: `HTTP ${res.status} ${res.statusText}\n${trimmed}`, isError: !res.ok };
  } catch (e) {
    return { result: `Integration call failed: ${e instanceof Error ? e.message : "error"}`, isError: true };
  }
}
