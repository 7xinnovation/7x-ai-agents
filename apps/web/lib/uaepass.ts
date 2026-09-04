/**
 * UAE PASS OIDC (authorization-code) for the customer sign-in flow used by the
 * embed. Endpoints follow the UAE PASS docs (https://docs.uaepass.ae):
 *   {base}/idshub/authorize | /idshub/token | /idshub/userinfo
 * Credentials come from env (UAEPASS_*), never from code. Staging base is
 * https://stg-id.uaepass.ae ; production is https://id.uaepass.ae.
 */
/**
 * Dev/staging-only: simulate the UAE PASS round-trip without hitting UAE PASS, so
 * the whole sign-in → callback → authenticated-session → chat flow can be tested
 * before the callback URL is registered with UAE PASS. Never enable in production.
 */
export function uaePassMock(): boolean {
  return process.env.UAEPASS_MOCK === "1";
}

export function uaePassConfigured(tenant?: string): boolean {
  if (uaePassMock()) return true;
  const { clientId, clientSecret } = credentials(tenant);
  return Boolean(clientId && clientSecret);
}

/**
 * Opt-in mock sign-in: permitted when the whole deployment is mocked
 * (UAEPASS_MOCK, dev/local), OR when a real deployment explicitly allows testers
 * to simulate a login via `?mock=1` WITHOUT disabling real UAE PASS for everyone
 * (UAEPASS_MOCK_ALLOWED). This is what lets QA test all flows on a live URL while
 * real customers still get the genuine UAE PASS flow. Turn it off by removing the
 * env var. A single request is mocked only when this is true AND the caller opted
 * in (the `mock` flag carried through the login → callback flow).
 */
export function uaePassMockAllowed(): boolean {
  return uaePassMock() || process.env.UAEPASS_MOCK_ALLOWED === "1";
}

/**
 * The PUBLIC origin (scheme + host) the customer actually reached — the custom
 * domain, the Railway URL, or localhost in dev. Behind a proxy (Railway)
 * `req.nextUrl.origin` is the internal localhost origin, so derive it from the
 * proxy's forwarded host headers instead. This is what keeps the whole UAE PASS
 * round-trip on ONE origin (so the flow cookie and the return both work).
 */
export function requestOrigin(req: {
  headers: { get(name: string): string | null };
  nextUrl: { origin: string; protocol: string };
}): string {
  // An explicit override wins (single fixed public domain deployments).
  const pin = process.env.PUBLIC_APP_URL;
  if (pin && /^https?:\/\//i.test(pin)) { try { return new URL(pin).origin; } catch { /* ignore */ } }
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(/:$/, "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

/**
 * The redirect/callback URL sent to UAE PASS. It stays on the SAME origin the
 * customer is on (from requestOrigin), so the flow cookie and the return both
 * work; that exact URL MUST be registered with UAE PASS for this client, or it
 * returns "callback.not.match". To pin one fixed public origin, set PUBLIC_APP_URL
 * (honoured by requestOrigin). UAEPASS_REDIRECT_URI is only a last-resort fallback
 * when no origin can be derived — do NOT set it to a single domain in a
 * multi-domain deployment (custom domain + Railway) or the callback is forced off
 * the domain the customer used and the flow cookie / return break.
 */
export function resolveRedirectUri(origin: string): string {
  return origin ? `${origin}/api/uaepass/callback` : (process.env.UAEPASS_REDIRECT_URI ?? "");
}

/**
 * UAE PASS credentials, per tenant.
 *
 * Each tenant registers its OWN UAE PASS client: NXN's is Emirates Post's PO Box
 * client (redirects at box.emiratespost.ae), EPGL will have a different one. The
 * config used to be a single set of app-level env vars, which meant whichever
 * tenant was configured last silently owned sign-in for every agent on the app —
 * and with NXN's prod client in place, an EPGL sign-in would have been sent to
 * Emirates Post's redirect and failed with callback.not.match.
 *
 * A tenant override is `<VAR>_<TENANT>`, e.g. UAEPASS_CLIENT_ID_EPGL. The plain
 * names remain the default, so an app with one tenant needs no change. Secrets
 * stay in the environment rather than the agent definition, which is not
 * encrypted.
 */
function envFor(name: string, tenant?: string): string | undefined {
  if (tenant) {
    const scoped = process.env[`${name}_${tenant.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
    if (scoped) return scoped;
  }
  return process.env[name];
}

/**
 * The client id and secret are resolved as a PAIR, from the same source.
 *
 * Falling back per-variable would let a half-configured tenant pair its own
 * client id with another tenant's secret — a mismatch UAE PASS rejects in a way
 * that reads like a UAE PASS outage rather than a missing env var. If either
 * tenant-scoped half is set, both must come from the tenant scope.
 */
function credentials(tenant?: string): { clientId: string; clientSecret: string } {
  const suffix = tenant ? `_${tenant.toUpperCase().replace(/[^A-Z0-9]/g, "_")}` : "";
  if (suffix) {
    const id = process.env[`UAEPASS_CLIENT_ID${suffix}`];
    const secret = process.env[`UAEPASS_CLIENT_SECRET${suffix}`];
    if (id || secret) return { clientId: id ?? "", clientSecret: secret ?? "" };
  }
  return {
    clientId: process.env.UAEPASS_CLIENT_ID ?? "",
    clientSecret: process.env.UAEPASS_CLIENT_SECRET ?? "",
  };
}

function cfg(tenant?: string) {
  const { clientId, clientSecret } = credentials(tenant);
  return {
    // The non-secret settings still fall back individually — a tenant that only
    // differs by client can keep sharing the base, scope and ACR.
    base: (envFor("UAEPASS_BASE", tenant) || "https://stg-id.uaepass.ae").replace(/\/$/, ""),
    clientId,
    clientSecret,
    scope: envFor("UAEPASS_SCOPE", tenant) || "urn:uae:digitalid:profile:general",
    acr: envFor("UAEPASS_ACR", tenant) || "urn:safelayer:tws:policies:authentication:level:low",
  };
}

/** Which tenants have their own UAE PASS client configured. For diagnostics. */
export function uaePassTenantsConfigured(): string[] {
  return Object.keys(process.env)
    .filter((k) => k.startsWith("UAEPASS_CLIENT_ID_"))
    .map((k) => k.slice("UAEPASS_CLIENT_ID_".length));
}

/** Build the UAE PASS authorize URL the customer is redirected to. */
export function buildAuthorizeUrl(redirectUri: string, state: string, tenant?: string): string {
  const c = cfg(tenant);
  const u = new URL(`${c.base}/idshub/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", c.scope);
  u.searchParams.set("state", state);
  u.searchParams.set("acr_values", c.acr);
  u.searchParams.set("ui_locales", "en");
  return u.toString();
}

export interface UaePassIdentity {
  accessToken: string;
  sub: string;
  name?: string;
  /**
   * The customer's Emirates ID, as UAE PASS states it (`idn`).
   *
   * This is the ONLY identifier EPGL's licence registry accepts, so a sign-in
   * that does not carry it forward leaves the whole lookup with nothing to look
   * up. Absent when the customer's UAE PASS profile does not expose it -- a
   * visitor-level account, for instance -- which is a normal answer, not a fault.
   */
  emiratesId?: string;
}

/** 15 digits, however UAE PASS punctuated them. */
function normaliseIdn(raw: unknown): string | undefined {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return /^\d{15}$/.test(digits) ? digits : undefined;
}

/** Exchange the auth code for an access token + verified identity. */
export async function exchangeCode(code: string, redirectUri: string, tenant?: string): Promise<UaePassIdentity> {
  const c = cfg(tenant);
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
  const tokenRes = await fetch(`${c.base}/idshub/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!tokenRes.ok) throw new Error(`UAE PASS token exchange failed: ${tokenRes.status} ${await tokenRes.text().catch(() => "")}`.slice(0, 200));
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("UAE PASS: no access_token returned");

  const userRes = await fetch(`${c.base}/idshub/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) throw new Error(`UAE PASS userinfo failed: ${userRes.status}`);
  const u = (await userRes.json()) as { sub?: string; uuid?: string; idn?: string; fullnameEN?: string; firstnameEN?: string; lastnameEN?: string };
  return {
    // UAE PASS returns the Emirates ID as `idn`. It was only ever read as a
    // FALLBACK for the subject and then discarded -- which left EPGL's licence
    // lookup with nothing to look up, since an Emirates ID is its only input.
    emiratesId: normaliseIdn(u.idn),
    accessToken: tokens.access_token,
    sub: u.sub || u.uuid || u.idn || "uaepass-user",
    name: u.fullnameEN || [u.firstnameEN, u.lastnameEN].filter(Boolean).join(" ") || undefined,
  };
}
