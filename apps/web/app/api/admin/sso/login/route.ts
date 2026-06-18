import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Microsoft Entra ID (Azure AD) SSO — step 1: redirect to the authorize
 * endpoint (OIDC auth-code flow). Enabled when AZURE_AD_* env vars are set;
 * otherwise returns a clear "not configured" response so the rest of the
 * console keeps working on password auth.
 */
export async function GET(req: NextRequest) {
  const tenant = process.env.AZURE_AD_TENANT_ID;
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  if (!tenant || !clientId) {
    return NextResponse.json({ error: "sso_not_configured", hint: "Set AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET to enable Microsoft SSO." }, { status: 501 });
  }
  const redirectUri = `${req.nextUrl.origin}/api/admin/sso/callback`;
  const state = crypto.randomUUID();
  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url.toString());
  res.cookies.set("dlg_sso_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
