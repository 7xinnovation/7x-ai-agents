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

export function uaePassConfigured(): boolean {
  return uaePassMock() || Boolean(process.env.UAEPASS_CLIENT_ID && process.env.UAEPASS_CLIENT_SECRET);
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

function cfg() {
  return {
    base: (process.env.UAEPASS_BASE || "https://stg-id.uaepass.ae").replace(/\/$/, ""),
    clientId: process.env.UAEPASS_CLIENT_ID ?? "",
    clientSecret: process.env.UAEPASS_CLIENT_SECRET ?? "",
    scope: process.env.UAEPASS_SCOPE || "urn:uae:digitalid:profile:general",
    acr: process.env.UAEPASS_ACR || "urn:safelayer:tws:policies:authentication:level:low",
  };
}

/** Build the UAE PASS authorize URL the customer is redirected to. */
export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const c = cfg();
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
}

/** Exchange the auth code for an access token + verified identity. */
export async function exchangeCode(code: string, redirectUri: string): Promise<UaePassIdentity> {
  const c = cfg();
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
    accessToken: tokens.access_token,
    sub: u.sub || u.uuid || u.idn || "uaepass-user",
    name: u.fullnameEN || [u.firstnameEN, u.lastnameEN].filter(Boolean).join(" ") || undefined,
  };
}
