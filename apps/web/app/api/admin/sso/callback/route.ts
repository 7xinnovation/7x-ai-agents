import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, createUser, markLogin } from "@/lib/users";
import { signSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Microsoft Entra ID SSO — step 2: exchange the auth code for tokens, read the
 * verified email from the id_token, map it to a console user (role from the DB),
 * and issue the signed RBAC session cookie. Unknown emails are provisioned as
 * "viewer" only when SSO_AUTO_PROVISION=1; otherwise access is denied until an
 * admin grants a role.
 */
export async function GET(req: NextRequest) {
  const tenant = process.env.AZURE_AD_TENANT_ID;
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) {
    return NextResponse.json({ error: "sso_not_configured" }, { status: 501 });
  }
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("dlg_sso_state")?.value;
  if (!code || !state || state !== expectedState) {
    return NextResponse.json({ error: "invalid_sso_state" }, { status: 400 });
  }

  const redirectUri = `${req.nextUrl.origin}/api/admin/sso/callback`;
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      scope: "openid profile email",
    }),
  });
  if (!tokenRes.ok) return NextResponse.json({ error: "token_exchange_failed" }, { status: 401 });
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) return NextResponse.json({ error: "no_id_token" }, { status: 401 });

  // Decode the id_token payload (signature already validated by the token endpoint
  // over TLS to Microsoft; for defense-in-depth a JWKS check can be added).
  const payloadB64 = tokens.id_token.split(".")[1] ?? "";
  const claims = JSON.parse(Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
    email?: string;
    preferred_username?: string;
    name?: string;
  };
  const email = (claims.email || claims.preferred_username || "").toLowerCase();
  if (!email) return NextResponse.json({ error: "no_email_claim" }, { status: 401 });

  let user = await getUserByEmail(email);
  if (!user) {
    if (process.env.SSO_AUTO_PROVISION !== "1") {
      return NextResponse.json({ error: "user_not_provisioned", email }, { status: 403 });
    }
    user = await createUser({ email, name: claims.name || email, role: "viewer", provider: "entra" });
  }
  if (!user.active) return NextResponse.json({ error: "user_disabled" }, { status: 403 });
  await markLogin(user.id);

  const token = await signSession({ uid: user.id, email: user.email, role: user.role });
  const res = NextResponse.redirect(`${req.nextUrl.origin}/admin`);
  res.cookies.set("dlg_admin", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 });
  res.cookies.delete("dlg_sso_state");
  return res;
}
