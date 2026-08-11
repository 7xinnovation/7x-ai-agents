import type Anthropic from "@anthropic-ai/sdk";
import { getDb, agentIntegrations } from "@dialog/db";
import { and, eq, desc } from "drizzle-orm";
import type { ApiOperation } from "./openapi";
import { encryptSecret, decryptSecret, isEncrypted } from "./crypto";
import { redactGuestPII } from "./pii";
import { simulateNxnMockOp, stagingTestBoxNumbers } from "./mockPersona";

export type EnvKey = "staging" | "production";

export type AuthType = "none" | "bearer" | "apiKey" | "uaepass_test" | "uaepass_live" | "oauth2_cc";

export interface EnvSpec {
  specUrl: string;
  baseUrl: string;
  // uaepass_test: use the stored token (authValue) as the session bearer.
  // uaepass_live: use the UAE PASS session token forwarded by the embedding site.
  // oauth2_cc: OAuth2 client-credentials (e.g. Salesforce External Client App) —
  //   authValue holds the client SECRET (encrypted); oauthClientId/oauthTokenUrl
  //   below complete the grant. Tokens are fetched + cached server-side.
  authType: AuthType;
  authValue: string | null;
  authHeader: string | null;
  // OAuth2 client-credentials fields (authType "oauth2_cc" only).
  oauthClientId?: string | null;
  oauthTokenUrl?: string | null;
  // Gateway/app API key sent on EVERY request (e.g. NXN guest APIs require an
  // X-API-KEY header). Independent of the per-user session above; both can apply.
  apiKey?: string | null;
  apiKeyHeader?: string | null; // defaults to "X-API-KEY"
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
  // Encrypt secrets at rest (PRD: encryption at rest for integration tokens).
  // A masked placeholder means "keep the existing secret" (admin re-save).
  const prev = existing?.environments[env];
  const authValue = spec.authValue === "••••••••" ? (prev?.authValue ?? null) : encryptSecret(spec.authValue);
  const apiKey = spec.apiKey === "••••••••" ? (prev?.apiKey ?? null) : encryptSecret(spec.apiKey);
  spec = { ...spec, authValue, apiKey };
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
 * Did a box-availability response actually carry any box numbers? Used to decide
 * whether the staging test set is needed — so a working upstream response (even a
 * shape we do not fully parse) always wins over the fallback.
 */
function hasBoxNumbers(result: string): boolean {
  const body = result.slice(result.indexOf("\n") + 1);
  if (!/^HTTP 2/.test(result)) return false;
  try {
    const json = JSON.parse(body);
    let found = false;
    const walk = (v: unknown, depth: number) => {
      if (found || depth > 5 || v === null) return;
      if (Array.isArray(v)) {
        // A non-empty array of box-shaped entries (or bare numbers) counts.
        if (v.length && v.some((x) => typeof x === "string" || typeof x === "number" || (x && typeof x === "object"))) found = true;
        for (const x of v) walk(x, depth + 1);
        return;
      }
      if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
    };
    // Only look under keys that would hold the list, so an error envelope with a
    // populated "errors" array is not mistaken for availability.
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (/^(payload|data|result|freeboxes|availableboxnumbers|boxes)$/i.test(k)) walk(v, 0);
    }
    return found;
  } catch {
    return false;
  }
}

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
 * Session tokens (auth). These are NOT interchangeable (FB-1485):
 *  - `sessionToken`  : a BACKEND session for THIS conversation (e.g. minted by the
 *                      OTP/passwordless flow on a previous turn). Valid bearer for
 *                      any token-auth integration.
 *  - captured at runtime: if a login op returns a backend token mid-turn, it is
 *                      captured and reused for subsequent protected calls;
 *                      `getCapturedToken()` lets the caller persist it.
 *  - `uaePassToken`  : a UAE PASS OIDC access token. It proves IDENTITY, it is not a
 *                      backend API session, so it is only sent to integrations that
 *                      declare authType "uaepass_live". Sending it to an integration
 *                      holding its own service token (authType "uaepass_test") made
 *                      every Emirates Post call 401 and the agent then asked an
 *                      already-signed-in customer to sign in again.
 */
export async function buildApiTools(
  agentId: string,
  activeEnv: EnvKey,
  opts: { uaePassToken?: string; sessionToken?: string; authenticated?: boolean; mockSimulate?: boolean } = {}
): Promise<{
  tools: Anthropic.Tool[];
  exec: (toolName: string, input: Record<string, unknown>) => Promise<{ result: string; isError?: boolean }>;
  getCapturedToken: () => string | null;
  getLastBranchQuery: () => { emirate: string; bundle: string } | null;
}> {
  const integrations = (await listIntegrations(agentId)).filter((i) => i.enabled);
  const tools: Anthropic.Tool[] = [];
  const map = new Map<string, { spec: EnvSpec; op: ApiOperation }>();

  for (const intg of integrations) {
    const spec = intg.environments[activeEnv];
    if (!spec) continue; // no spec for the active environment
    const pfx = prefix(intg.name);
    for (const op of spec.operations) {
      // Operations can be explicitly disabled (e.g. a backend write that isn't
      // provisioned, or an auth-only duplicate) so they never become a tool.
      if ((op as { enabled?: boolean }).enabled === false) continue;
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

  // Runtime BACKEND session token: one captured this turn takes priority over one
  // persisted from a previous turn. The UAE PASS identity token is deliberately NOT
  // part of this chain — it is offered separately and only honoured by uaepass_live.
  let captured: string | null = null;
  const runtimeToken = () => captured ?? opts.sessionToken ?? undefined;

  // Remember the emirate + bundle of the most recent branch-locations lookup so
  // the route can deterministically render the "browse nearby branches" map even
  // when the model forgets to emit the ```map block (which it does often).
  let lastBranchQuery: { emirate: string; bundle: string } | null = null;
  const asStr = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
  // How many times each branch's box list has been asked for this turn, so a
  // "Refresh" pages further into the staging test set instead of repeating.
  const freeBoxPages = new Map<string, number>();

  const exec = async (toolName: string, input: Record<string, unknown>) => {
    const entry = map.get(toolName);
    if (!entry) return { result: `Unknown integration tool ${toolName}.`, isError: true };
    // Read-only lookups are served from a short-lived cache. Profiling showed the
    // model re-fetching the same catalogue (bundles, branches) on consecutive
    // turns, and every repeat cost a whole model round (~3s) plus a call to a
    // backend that is not always healthy. Cached only for GETs, only on success,
    // and keyed so a different customer or a different privacy view can never
    // read another's entry (see readCache).
    const cacheKey = readCacheKey(entry.op, toolName, input, opts, runtimeToken());
    if (cacheKey) {
      const hit = readCache(cacheKey);
      if (process.env.DIALOG_DEBUG_CACHE === "1") {
        console.log(`[lookup-cache] ${hit ? "HIT " : "miss"} ${toolName} ${JSON.stringify(input ?? {})}`);
      }
      if (hit) return hit;
    } else if (process.env.DIALOG_DEBUG_CACHE === "1") {
      console.log(`[lookup-cache] skip ${toolName} (${entry.op.method}${isAuthOperation(entry.op) ? ", auth op" : ""})`);
    }
    // TEST-ONLY: for the mock persona, substitute realistic responses for the EP
    // ops that can't hit the real API (no live session / fake box) so the demo
    // completes. Branch locations are real (auth=false), so not simulated here.
    if (opts.mockSimulate) {
      const sim = simulateNxnMockOp(toolName, input ?? {});
      if (sim) return sim;
    }
    // Capture branch-locations queries (BundleId + EmirateCode) for the map widget.
    if (/boxlocations/i.test(toolName)) {
      const inp = (input ?? {}) as Record<string, unknown>;
      const bundle = asStr(inp.BundleId ?? inp.bundleId ?? inp.bundle_Id ?? inp.bundle);
      const emirate = asStr(inp.EmirateCode ?? inp.emirateCode ?? inp.Emirate ?? inp.emirate).toUpperCase();
      if (bundle && emirate) lastBranchQuery = { emirate, bundle };
    }
    // Decrypt stored secrets only at the moment of the outbound call.
    const liveSpec: EnvSpec = {
      ...entry.spec,
      authValue: isEncrypted(entry.spec.authValue) ? decryptSecret(entry.spec.authValue) : entry.spec.authValue,
      apiKey: isEncrypted(entry.spec.apiKey) ? decryptSecret(entry.spec.apiKey) : entry.spec.apiKey,
    };
    // Guest privacy: with no verified identity (no UAE PASS / OTP session and the
    // conversation isn't authenticated), backend responses are PII-redacted before
    // the model sees them — a guest proving knowledge of a box number must not
    // learn the holder's name, email, phone, or ID.
    const identified = Boolean(opts.authenticated) || Boolean(runtimeToken()) || Boolean(opts.uaePassToken);
    const res = await executeOperation(liveSpec, entry.op, input ?? {}, runtimeToken(), {
      redactPII: !identified,
      identityToken: opts.uaePassToken,
      // Already-verified customer: a backend 401 must never be reported as "sign in
      // again" (FB-1485) — their identity is fine, that backend session is not.
      customerAuthenticated: Boolean(opts.authenticated) || Boolean(opts.uaePassToken),
    });
    // Capture a freshly-minted session token from a login/token op for reuse.
    if (!res.isError && isAuthOperation(entry.op)) {
      const body = res.result.slice(res.result.indexOf("\n") + 1);
      const tok = extractSessionToken(body);
      if (tok) captured = tok;
    }

    // STAGING ONLY — reserved test box numbers.
    // Emirates Post staging cannot serve box availability (Rental/FreeBoxes needs a
    // live EP session, and there is no inventory behind it), so every rental journey
    // stopped at the box-number step. When the real call cannot produce numbers, fall
    // back to a deterministic reserved set so the journey can be tested end to end.
    // Gated on the agent's activeEnvironment, so it disappears on its own the moment
    // an agent is switched to production.
    if (activeEnv === "staging" && /freeboxes/i.test(toolName) && !hasBoxNumbers(res.result)) {
      const inp = (input ?? {}) as Record<string, unknown>;
      const bundleId = asStr(inp.BundleId ?? inp.bundleId ?? inp.bundle_Id);
      const locationId = asStr(inp.LocationId ?? inp.locationId ?? inp.OfficeId ?? inp.officeId);
      // Each repeat call for the same branch pages further in, so "Refresh" shows a
      // genuinely different set rather than the same numbers again.
      const key = `${bundleId}|${locationId}`;
      const page = freeBoxPages.get(key) ?? 0;
      freeBoxPages.set(key, page + 1);
      const boxes = stagingTestBoxNumbers(bundleId, locationId, page);
      return {
        result:
          `HTTP 200 OK\n${JSON.stringify({
            success: true,
            stagingTestData: true,
            count: boxes.length,
            availableBoxNumbers: boxes,
            freeBoxes: boxes.map((b) => ({ boxNumber: b, available: true })),
          })}\n\nNOTE FOR THE ASSISTANT: Emirates Post staging does not publish live box availability, so these are ` +
          `RESERVED TEST box numbers for this staging environment. Present them as the available box numbers for the ` +
          `chosen branch and let the customer pick one so the journey can continue; "Refresh" returns a different set. ` +
          `They are real, selectable choices for testing purposes — do not describe them as confirmed live inventory, ` +
          `and if the customer asks whether these are live numbers, say plainly that this is a test environment.`,
        isError: false,
      };
    }
    if (cacheKey && !res.isError) writeCache(cacheKey, res);
    return res;
  };

  return { tools, exec, getCapturedToken: () => captured, getLastBranchQuery: () => lastBranchQuery };
}

/**
 * Short-lived cache for read-only integration lookups.
 *
 * Why: profiling a live NXN rental showed Rental/Bundle fetched again on the very
 * next turn. Each repeat is a full model round (~3s) plus a call to a backend
 * that is not always healthy, so caching removes both the latency and a failure
 * mode. Catalogue data (bundles, branches, expiry dates) does not change within
 * a conversation.
 *
 * Safety — the key includes everything that could change what a caller is
 * allowed to see, so an entry can never be served to the wrong person:
 *   - the operation and its exact inputs,
 *   - the caller's PRIVACY VIEW (guest results are PII-redacted; an identified
 *     caller must not be served a redacted entry, nor the reverse),
 *   - a fingerprint of the session token in play (a customer's own session can
 *     make the backend return their record rather than a public one).
 * Writes, auth/login operations and error responses are never cached.
 */
const LOOKUP_TTL_MS = 90_000;
const LOOKUP_CACHE_MAX = 400;
const lookupCache = new Map<string, { at: number; value: { result: string; isError?: boolean } }>();

/** Cheap, non-reversible fingerprint — the token itself is never used as a key. */
function fingerprint(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function readCacheKey(
  op: ApiOperation,
  toolName: string,
  input: Record<string, unknown>,
  opts: { authenticated?: boolean; uaePassToken?: string; mockSimulate?: boolean },
  token: string | undefined
): string | null {
  if (op.method.toUpperCase() !== "GET") return null;   // never cache writes
  if (isAuthOperation(op)) return null;                 // never cache token minting
  const identified = Boolean(opts.authenticated) || Boolean(token) || Boolean(opts.uaePassToken);
  return [
    toolName,
    JSON.stringify(input ?? {}),
    identified ? "id" : "guest",
    token ? fingerprint(token) : "-",
  ].join("|");
}

function readCache(key: string): { result: string; isError?: boolean } | null {
  const hit = lookupCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > LOOKUP_TTL_MS) { lookupCache.delete(key); return null; }
  return hit.value;
}

function writeCache(key: string, value: { result: string; isError?: boolean }) {
  lookupCache.set(key, { at: Date.now(), value });
  // Bounded: drop the oldest entries once over the cap (insertion-ordered Map).
  while (lookupCache.size > LOOKUP_CACHE_MAX) {
    const oldest = lookupCache.keys().next().value;
    if (oldest === undefined) break;
    lookupCache.delete(oldest);
  }
}

/**
 * OAuth2 client-credentials token cache (e.g. Salesforce External Client App).
 * Salesforce's token endpoint takes x-www-form-urlencoded grant_type=client_credentials
 * and REJECTS a "scope" parameter (scope policy lives on the app). Tokens are
 * cached per (tokenUrl, clientId) and invalidated on a 401 so the next call
 * re-mints; Salesforce doesn't reliably return expires_in for this grant, so we
 * cap cache age conservatively.
 */
const OAUTH_CACHE_TTL_MS = 20 * 60_000;
const oauthTokens = new Map<string, { token: string; fetchedAt: number }>();

async function getClientCredentialsToken(spec: EnvSpec, forceRefresh = false): Promise<string> {
  const tokenUrl = spec.oauthTokenUrl || "";
  const clientId = spec.oauthClientId || "";
  const clientSecret = spec.authValue || "";
  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error("OAuth2 client-credentials integration is not fully configured (token URL / client id / secret).");
  }
  const key = `${tokenUrl}|${clientId}`;
  const hit = oauthTokens.get(key);
  if (!forceRefresh && hit && Date.now() - hit.fetchedAt < OAUTH_CACHE_TTL_MS) return hit.token;

  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`OAuth2 token request failed (HTTP ${res.status}): ${text}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("OAuth2 token response had no access_token.");
  oauthTokens.set(key, { token: json.access_token, fetchedAt: Date.now() });
  return json.access_token;
}

export async function executeOperation(
  spec: EnvSpec,
  op: ApiOperation,
  input: Record<string, unknown>,
  runtimeToken?: string,
  opts: { redactPII?: boolean; identityToken?: string; customerAuthenticated?: boolean } = {}
): Promise<{ result: string; isError?: boolean }> {
  try {
    const tokenAuth = spec.authType === "bearer" || spec.authType === "uaepass_test" || spec.authType === "uaepass_live";
    // Effective bearer, in strict precedence (FB-1485):
    //  1. a BACKEND session for this conversation (OTP-minted / captured this turn);
    //  2. the integration's own stored service token (bearer / uaepass_test);
    //  3. the UAE PASS identity token — ONLY for uaepass_live, which is the one
    //     authType that documents the customer's UAE PASS session as its bearer.
    // Sending a UAE PASS identity token to an integration that holds its own service
    // token 401s the whole backend for signed-in customers.
    const stored = spec.authType === "bearer" || spec.authType === "uaepass_test" ? spec.authValue : null;
    const identity = spec.authType === "uaepass_live" ? opts.identityToken : undefined;
    const bearer = runtimeToken ?? stored ?? identity ?? null;
    /**
     * WHICH credential we sent — this decides what a 401 means. Rejecting the
     * customer's own UAE PASS session (which is short-lived) genuinely calls for
     * signing in again; rejecting a service token says nothing about the customer
     * and must never bounce them through sign-in.
     */
    const bearerSource: "session" | "service" | "identity" | "none" = runtimeToken
      ? "session"
      : stored
        ? "service"
        : identity
          ? "identity"
          : "none";

    // No session at all. A customer who IS already verified must never be told to
    // sign in again — that is a backend-availability problem, not an identity one.
    const signInMsg = opts.customerAuthenticated
      ? "This backend action could not be authorised: the customer is already signed in, so do NOT ask them to sign in again and do NOT start a passcode flow. Tell them this detail cannot be retrieved from the system right now, continue with whatever you can do without it, and offer a callback if it blocks them. Never invent a result."
      : "This action needs the customer to be signed in, but no active session is available yet. " +
        (spec.authType === "uaepass_live"
          ? "Ask them to sign in with UAE PASS on the website, "
          : "Start the sign-in (one-time passcode) flow to obtain a session, ") +
        "or offer a callback. Do not invent a result.";

    // A gateway/app API key is a credential in its own right: the Emirates Post
    // guest endpoints (Rental/FreeBoxes, Guest/Renewal/Details and /Pricing)
    // authorise on X-API-KEY alone even though the swagger marks them secured. So
    // an operation is only pre-blocked when we hold NO credential at all.
    // Without this, removing the UAE PASS identity token from the bearer chain
    // silently blocked those reads before they were even attempted — they had
    // been passing the pre-gate only because that token happened to fill the
    // bearer slot, never because the backend wanted it.
    const hasGatewayKey = Boolean(spec.apiKey);

    // Pre-gate ONLY operations the spec explicitly marks as secured (and only when
    // we have no credential at all and it isn't itself a login op). Guest/public
    // endpoints — and specs that declare no security at all — are NOT blocked here;
    // the backend decides via a 401/403, which we translate gracefully below.
    if (tokenAuth && !bearer && !hasGatewayKey && op.requiresAuth && !isAuthOperation(op)) {
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

    // System-level OAuth2 client-credentials (e.g. Salesforce): mint/reuse a
    // cached app token. This is machine auth — never the customer's session.
    const oauthCC = spec.authType === "oauth2_cc";
    if (oauthCC) {
      try {
        headers["Authorization"] = `Bearer ${await getClientCredentialsToken(spec)}`;
      } catch (e) {
        return {
          result: `The backend integration could not authenticate: ${e instanceof Error ? e.message : "error"}. Tell the customer this service is temporarily unavailable and offer a callback — the operations team must verify the integration credentials.`,
          isError: true,
        };
      }
    } else if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    if (spec.authType === "apiKey" && spec.authValue) headers[spec.authHeader || "X-API-Key"] = spec.authValue;
    // Gateway/app API key sent on EVERY request when configured (e.g. NXN guest APIs).
    if (spec.apiKey) headers[spec.apiKeyHeader || "X-API-KEY"] = spec.apiKey;

    let body: string | undefined;
    if (op.hasBody && input.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(input.body);
    }

    const qs = query.toString();
    const url = `${spec.baseUrl}${path}${qs ? `?${qs}` : ""}`;

    const doFetch = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        return await fetch(url, { method: op.method, headers, body, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    };
    let res = await doFetch();
    // Cached app token may have been revoked/expired server-side — re-mint once.
    if (oauthCC && res.status === 401) {
      try {
        headers["Authorization"] = `Bearer ${await getClientCredentialsToken(spec, true)}`;
        res = await doFetch();
      } catch {
        /* fall through to the generic 401 handling below */
      }
    }

    // Backend says auth is required/insufficient — translate to guidance instead
    // of a raw 401/403 (the backend is the source of truth for what needs a session).
    if ((res.status === 401 || res.status === 403) && tokenAuth && !isAuthOperation(op)) {
      if (!bearer) return { result: signInMsg, isError: true };
      // What was rejected decides the remedy (FB-1485).
      if (bearerSource === "identity") {
        // The customer's own UAE PASS session was refused — these are short-lived,
        // so it has most likely expired mid-conversation. Re-authenticating IS the
        // fix here, so offering it is correct rather than a dead end.
        return {
          result:
            "The customer's UAE PASS session was rejected by the backend — it has most likely EXPIRED (these sessions are short-lived). Explain in one short sentence that their sign-in needs refreshing, ask them to sign in with UAE PASS again to continue, and keep everything already collected. Do not start a one-time-passcode flow and do not invent a result.",
          isError: true,
        };
      }
      if (bearerSource === "session") {
        return {
          result:
            "The backend session obtained earlier in this conversation was rejected (expired or invalid). Re-run the sign-in (one-time passcode) flow to obtain a fresh session, or offer a callback. Do not invent a result.",
          isError: true,
        };
      }
      // A service/app credential was refused. The customer's sign-in is irrelevant,
      // so never bounce them through sign-in — that reads as being logged out.
      return {
        result:
          "This backend endpoint rejected the integration's own service credentials. The customer's sign-in is NOT the problem: do NOT ask them to sign in again, do NOT say their session expired, and do NOT start a passcode flow. Say plainly that this particular detail is not available from the system at the moment, carry on with everything you can complete without it, and offer a callback only if it genuinely blocks them.",
        isError: true,
      };
    }

    let text = await res.text();
    // Redact BEFORE truncation so a long payload can't smuggle PII past the cut.
    if (opts.redactPII) text = redactGuestPII(text);
    const trimmed = text.length > 4000 ? text.slice(0, 4000) + "…(truncated)" : text;
    return { result: `HTTP ${res.status} ${res.statusText}\n${trimmed}`, isError: !res.ok };
  } catch (e) {
    return { result: `Integration call failed: ${e instanceof Error ? e.message : "error"}`, isError: true };
  }
}
