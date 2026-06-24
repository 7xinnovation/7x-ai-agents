/**
 * UAE PASS OIDC (authorization-code) for the customer sign-in flow used by the
 * embed. Endpoints follow the UAE PASS docs (https://docs.uaepass.ae):
 *   {base}/idshub/authorize | /idshub/token | /idshub/userinfo
 * Credentials come from env (UAEPASS_*), never from code. Staging base is
 * https://stg-id.uaepass.ae ; production is https://id.uaepass.ae.
 */
export function uaePassConfigured(): boolean {
  return Boolean(process.env.UAEPASS_CLIENT_ID && process.env.UAEPASS_CLIENT_SECRET);
}

/**
 * The redirect/callback URL. MUST exactly match a URL registered with UAE PASS
 * for this client, or UAE PASS returns "callback.not.match". Set
 * UAEPASS_REDIRECT_URI to the registered value; otherwise defaults to this app's
 * own callback on the request origin.
 */
export function resolveRedirectUri(origin: string): string {
  return process.env.UAEPASS_REDIRECT_URI || `${origin}/api/uaepass/callback`;
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
