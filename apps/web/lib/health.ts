import { listIntegrations, type EnvKey, type EnvSpec } from "./integrations";
import { decryptSecret, isEncrypted } from "./crypto";
import { epglAuth } from "./epglRead";
import { epUsersBaseUrl } from "./hostToken";
import { providerFor } from "./email";
import { uaePassConfigured } from "./uaepass";
import { getDb, agents, kbChunks } from "@dialog/db";
import { eq } from "drizzle-orm";

/**
 * Is every integration actually answering?
 *
 * Asked for on 24 September: somewhere an administrator can see, at a glance,
 * which of the services behind these two agents is down — rather than finding
 * out from a customer who could not sign in, or from a screenshot of a chat
 * that went wrong.
 *
 * EVERY PROBE IS READ-ONLY, and that is the constraint the whole file is built
 * around. A health page that creates a payment order, sends an email or files a
 * case is a page nobody dares refresh. So: tokens are minted but nothing is
 * charged, a tracking number is looked up but nothing is written, and where a
 * service offers no safe read the check says so rather than inventing one.
 *
 * "Not configured" is reported as its own state, not as a failure. Production
 * NXN deliberately points at Emirates Post's staging backend, EPGL staging has
 * no production Salesforce, and an amber row saying so is information; a red one
 * saying "down" would be a lie that trains people to ignore the page.
 */

export type HealthState = "ok" | "degraded" | "down" | "not_configured";

export interface HealthCheck {
  /** The agent this belongs to, or null for something shared. */
  agent: string | null;
  name: string;
  /** What it is for, in a few words, so the page needs no glossary. */
  purpose: string;
  state: HealthState;
  /** One line a person can act on. Never a stack trace. */
  detail: string;
  ms: number | null;
}

export interface HealthReport {
  checkedAt: string;
  environment: string;
  checks: HealthCheck[];
  summary: { ok: number; degraded: number; down: number; notConfigured: number };
}

/** Nothing on this page may hang the page. */
const TIMEOUT_MS = 8000;

async function timed<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return { value: await fn(ctl.signal), ms: Date.now() - started };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? `no answer in ${TIMEOUT_MS / 1000}s` : (e as Error).message;
    return { error: msg, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const check = (
  agent: string | null,
  name: string,
  purpose: string,
  state: HealthState,
  detail: string,
  ms: number | null = null
): HealthCheck => ({ agent, name, purpose, state, detail, ms });

/** An integration's spec for one environment, with its secrets decrypted. */
async function specOf(agentId: string, env: EnvKey, match: RegExp) {
  const row = (await listIntegrations(agentId)).find((r) => match.test(r.name) && r.enabled && r.environments[env]);
  const spec = row?.environments[env] as EnvSpec | undefined;
  if (!spec) return null;
  const apiKey = isEncrypted(spec.apiKey) ? decryptSecret(spec.apiKey) : spec.apiKey;
  return { name: row!.name, baseUrl: String(spec.baseUrl ?? "").replace(/\/$/, ""), apiKey: apiKey ?? undefined, header: spec.apiKeyHeader || "X-API-KEY" };
}

/* ── EPGL ────────────────────────────────────────────────────────────────── */

async function epglSalesforce(agentId: string, env: EnvKey): Promise<HealthCheck> {
  const meta = { agent: "EPGL", name: "Salesforce", purpose: "Licence applications, renewals and callback cases" };
  const r = await timed(async (signal) => {
    // Minting a token exercises the connected app, the run-as user and the
    // network in one call, and writes nothing. The identity read that follows
    // proves the token is actually usable.
    const auth = await epglAuth(agentId, env);
    const res = await fetch(`${auth.baseUrl}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${auth.bearer}` },
      signal,
    });
    if (!res.ok) throw new Error(`userinfo returned HTTP ${res.status}`);
    const j = (await res.json()) as { preferred_username?: string };
    return j.preferred_username ?? "authenticated";
  });
  if (r.error) {
    const missing = /not configured/i.test(r.error);
    return check(meta.agent, meta.name, meta.purpose, missing ? "not_configured" : "down", r.error, r.ms);
  }
  return check(meta.agent, meta.name, meta.purpose, "ok", `connected as ${r.value}`, r.ms);
}

async function epglRegistry(agentId: string, env: EnvKey): Promise<HealthCheck> {
  const meta = { agent: "EPGL", name: "IDEP / MoE registry", purpose: "A signed-in customer's trade licences, by Emirates ID" };
  const base = (process.env.MOE_API_BASE_URL ?? "").replace(/\/$/, "");
  const id = process.env.MOE_API_CLIENT_ID;
  const secret = process.env.MOE_API_CLIENT_SECRET;
  if (!base || !id || !secret) return check(meta.agent, meta.name, meta.purpose, "not_configured", "MOE_API_BASE_URL / CLIENT_ID / CLIENT_SECRET not set");
  const r = await timed(async (signal) => {
    // Authenticate only. The lookup itself is rate-limited per day by their
    // gateway, and a health page must not spend a customer's allowance.
    const res = await fetch(`${base}/api/v1/Auth/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ clientId: id, clientSecret: secret }),
      signal,
    });
    if (!res.ok) throw new Error(`authenticate returned HTTP ${res.status}`);
    return base;
  });
  return r.error
    ? check(meta.agent, meta.name, meta.purpose, "down", r.error, r.ms)
    : check(meta.agent, meta.name, meta.purpose, "ok", `authenticated against ${base}`, r.ms);
}

/* ── Emirates Post ───────────────────────────────────────────────────────── */

async function poBoxApi(agentId: string, env: EnvKey): Promise<HealthCheck> {
  const meta = { agent: "Emirates Post", name: "PO Box API", purpose: "Rentals, renewals, boxes and branches" };
  const spec = await specOf(agentId, env, /nxn/i);
  if (!spec?.baseUrl) return check(meta.agent, meta.name, meta.purpose, "not_configured", "no NXN integration for this environment");
  const r = await timed(async (signal) => {
    const res = await fetch(`${spec.baseUrl}/users/api/v1/Account`, {
      headers: { Accept: "application/json", ...(spec.apiKey ? { [spec.header]: spec.apiKey } : {}) },
      signal,
    });
    // 401 is the CORRECT answer to an unauthenticated identity read: the service
    // is up and enforcing. Anything 5xx is the service itself.
    if (res.status >= 500) throw new Error(`HTTP ${res.status} from their service`);
    return res.status;
  });
  if (r.error) return check(meta.agent, meta.name, meta.purpose, "down", r.error, r.ms);
  const staging = /-stg\./.test(spec.baseUrl);
  return check(
    meta.agent,
    meta.name,
    meta.purpose,
    env === "production" && staging ? "degraded" : "ok",
    env === "production" && staging
      ? `answering, but production is pointed at their STAGING backend (${spec.baseUrl})`
      : `answering on ${spec.baseUrl} (HTTP ${r.value})`,
    r.ms
  );
}

async function tracking(agentId: string, env: EnvKey): Promise<HealthCheck> {
  const meta = { agent: "Emirates Post", name: "Shipment tracking", purpose: "Where a parcel has got to, by AWB" };
  const spec = await specOf(agentId, env, /emx|tracking/i);
  if (!spec?.baseUrl || !spec.apiKey) return check(meta.agent, meta.name, meta.purpose, "not_configured", "no EMX Tracking integration for this environment");
  const r = await timed(async (signal) => {
    // A number that cannot exist: proves the gateway answers and the key is
    // accepted, without reading anybody's shipment.
    const res = await fetch(`${spec.baseUrl}/tracking/api/Tracking?awbNumber=ZZ000000000AE`, {
      headers: { [spec.header]: spec.apiKey!, Accept: "application/json" },
      signal,
    });
    if (res.status === 401 || res.status === 403) throw new Error(`the API key was refused (HTTP ${res.status})`);
    if (res.status >= 500) throw new Error(`HTTP ${res.status} from their gateway`);
    return res.status;
  });
  return r.error
    ? check(meta.agent, meta.name, meta.purpose, "down", r.error, r.ms)
    : check(meta.agent, meta.name, meta.purpose, "ok", `gateway answering and the key accepted (HTTP ${r.value})`, r.ms);
}

async function invoice(agentId: string, env: EnvKey): Promise<HealthCheck> {
  const meta = { agent: "Emirates Post", name: "Invoice", purpose: "The PDF a customer downloads after paying" };
  const base = await epUsersBaseUrl(agentId, env).catch(() => undefined);
  if (!base) return check(meta.agent, meta.name, meta.purpose, "not_configured", "no users service for this environment");
  const r = await timed(async (signal) => {
    // Their endpoint answers 500 for a reference it does not know, so this can
    // only confirm the route exists and responds — which is what a fallback to
    // our own receipt depends on.
    const res = await fetch(`${base}/api/v1/Invoice?PaymentReferenceNumber=00000000-0000-0000-0000-000000000000&IsFile=true`, { signal });
    return res.status;
  });
  return r.error
    ? check(meta.agent, meta.name, meta.purpose, "down", r.error, r.ms)
    : check(meta.agent, meta.name, meta.purpose, "ok", `reachable (HTTP ${r.value} for an unknown reference, as expected)`, r.ms);
}

/* ── Shared ──────────────────────────────────────────────────────────────── */

async function paymentGateway(agentId: string, agentLabel: string, env: EnvKey): Promise<HealthCheck> {
  const meta = { name: "Payment gateway", purpose: "Taking card payments (N-Genius)" };
  const def = (await getDb().query.agents.findFirst({ where: eq(agents.id, agentId) }))?.definition as
    | { integrations?: { payment?: { settings?: Record<string, unknown>; secretRefs?: string[] } } }
    | undefined;
  const settings = def?.integrations?.payment?.settings ?? {};
  const base = String(settings.baseUrl ?? "").replace(/\/$/, "");
  const apiKey = (def?.integrations?.payment?.secretRefs ?? []).map((r) => process.env[r]).find(Boolean);
  if (!base || !apiKey) return check(agentLabel, meta.name, meta.purpose, "not_configured", "no gateway base URL or API key");
  const r = await timed(async (signal) => {
    // A token, and no order. Creating one would leave a payment nobody made.
    const res = await fetch(`${base}/identity/auth/access-token`, {
      method: "POST",
      headers: { Authorization: `Basic ${apiKey}`, "Content-Type": "application/vnd.ni-identity.v1+json", Accept: "application/vnd.ni-identity.v1+json" },
      body: "{}",
      signal,
    });
    if (!res.ok) throw new Error(`auth returned HTTP ${res.status}`);
    return base;
  });
  if (r.error) return check(agentLabel, meta.name, meta.purpose, "down", r.error, r.ms);
  const sandbox = /sandbox/.test(base);
  return check(
    agentLabel,
    meta.name,
    meta.purpose,
    env === "production" && sandbox ? "degraded" : "ok",
    env === "production" && sandbox ? `authenticated, but against the SANDBOX gateway (${base})` : `authenticated against ${base}`,
    r.ms
  );
}

async function email(tenant: string, agentLabel: string): Promise<HealthCheck> {
  const meta = { name: "Email", purpose: "Confirmations and receipts" };
  const p = providerFor(tenant);
  const from = p.from;
  if (p.sendgridKey) {
    const r = await timed(async (signal) => {
      // Scopes, not a send. A health page that emails somebody is a health page
      // nobody refreshes.
      const res = await fetch("https://api.sendgrid.com/v3/scopes", { headers: { Authorization: `Bearer ${p.sendgridKey}` }, signal });
      if (!res.ok) throw new Error(`SendGrid returned HTTP ${res.status}`);
      const j = (await res.json()) as { scopes?: string[] };
      if (!j.scopes?.includes("mail.send")) throw new Error("the key cannot send mail (no mail.send scope)");
      return true;
    });
    return r.error
      ? check(agentLabel, meta.name, meta.purpose, "down", r.error, r.ms)
      : check(agentLabel, meta.name, meta.purpose, "ok", `SendGrid, sending as ${from}`, r.ms);
  }
  if (p.resendKey) {
    const r = await timed(async (signal) => {
      const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${p.resendKey}` }, signal });
      if (!res.ok) throw new Error(`Resend returned HTTP ${res.status}`);
      return true;
    });
    return r.error
      ? check(agentLabel, meta.name, meta.purpose, "down", r.error, r.ms)
      : check(agentLabel, meta.name, meta.purpose, "ok", `Resend, sending as ${from}`, r.ms);
  }
  if (p.webhookUrl) return check(agentLabel, meta.name, meta.purpose, "ok", `relayed to ${p.webhookUrl}, sending as ${from}`);
  return check(agentLabel, meta.name, meta.purpose, "not_configured", "no email provider configured");
}

function uaePass(tenant: string, agentLabel: string): HealthCheck {
  const meta = { name: "UAE PASS", purpose: "Signing the customer in" };
  const suffix = `_${tenant.toUpperCase()}`;
  const hostKey = process.env[`HOST_TOKEN_PUBLIC_KEY${suffix}`] || process.env[`HOST_TOKEN_HS256_SECRET${suffix}`];
  // A host that signs its own tokens does not need our client at all.
  if (hostKey) return check(agentLabel, meta.name, meta.purpose, "ok", "the host signs in and hands us a token we verify against their key");
  if (!uaePassConfigured(tenant)) return check(agentLabel, meta.name, meta.purpose, "not_configured", `no UAE PASS client for this tenant (UAEPASS_CLIENT_ID${suffix})`);
  const mock = process.env.UAEPASS_MOCK === "1";
  const testers = process.env.UAEPASS_MOCK_ALLOWED === "1";
  return check(
    agentLabel,
    meta.name,
    meta.purpose,
    mock ? "degraded" : "ok",
    mock ? "MOCK sign-in is on — nobody is really being verified" : testers ? "configured; testers may also use ?mock=1" : "configured"
  );
}

async function knowledge(agentId: string, agentLabel: string): Promise<HealthCheck> {
  const meta = { name: "Knowledge base", purpose: "The approved answers the agent quotes" };
  const r = await timed(async () => {
    // A count, not the content — that is not this page's business. It also
    // proves the database answers, which nothing else here does.
    const rows = await getDb().select({ id: kbChunks.id }).from(kbChunks).where(eq(kbChunks.agentId, agentId)).limit(500);
    if (!rows.length) throw new Error("no knowledge chunks for this agent");
    return rows.length >= 500 ? "500+" : String(rows.length);
  });
  return r.error
    ? check(agentLabel, meta.name, meta.purpose, r.error.includes("no knowledge chunks") ? "degraded" : "down", r.error, r.ms)
    : check(agentLabel, meta.name, meta.purpose, "ok", `${r.value} chunks indexed`, r.ms);
}

/* ── The report ──────────────────────────────────────────────────────────── */

export async function assessHealth(): Promise<HealthReport> {
  const db = getDb();
  const all = await db.select().from(agents);
  const epgl = all.find((a) => a.slug === "epgl-dialog");
  const nxn = all.find((a) => a.slug === "nxn-dialog");
  const env = ((epgl ?? nxn)?.definition as { activeEnvironment?: EnvKey })?.activeEnvironment ?? "production";

  const jobs: Promise<HealthCheck>[] = [];
  if (epgl) {
    const e = (epgl.definition as { activeEnvironment?: EnvKey }).activeEnvironment ?? "production";
    jobs.push(
      epglSalesforce(epgl.id, e),
      epglRegistry(epgl.id, e),
      paymentGateway(epgl.id, "EPGL", e),
      email("epgl", "EPGL"),
      Promise.resolve(uaePass("epgl", "EPGL")),
      knowledge(epgl.id, "EPGL")
    );
  }
  if (nxn) {
    const e = (nxn.definition as { activeEnvironment?: EnvKey }).activeEnvironment ?? "production";
    jobs.push(
      poBoxApi(nxn.id, e),
      tracking(nxn.id, e),
      invoice(nxn.id, e),
      paymentGateway(nxn.id, "Emirates Post", e),
      email("nxn", "Emirates Post"),
      Promise.resolve(uaePass("nxn", "Emirates Post")),
      knowledge(nxn.id, "Emirates Post")
    );
  }

  // One slow service must not decide how long the page takes, and one that
  // throws where it should have returned must not blank the whole report.
  const settled = await Promise.allSettled(jobs);
  const checks = settled.map((s) =>
    s.status === "fulfilled"
      ? s.value
      : check(null, "Unknown check", "—", "down", `the check itself failed: ${String(s.reason).slice(0, 120)}`)
  );

  return {
    checkedAt: new Date().toISOString(),
    environment: env,
    checks,
    summary: {
      ok: checks.filter((c) => c.state === "ok").length,
      degraded: checks.filter((c) => c.state === "degraded").length,
      down: checks.filter((c) => c.state === "down").length,
      notConfigured: checks.filter((c) => c.state === "not_configured").length,
    },
  };
}
