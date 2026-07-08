import { LoginClient } from "./LoginClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin sign-in. Microsoft SSO appears only when the Entra app is configured. */
export default function AdminLogin() {
  const ssoEnabled = Boolean(process.env.AZURE_AD_TENANT_ID && process.env.AZURE_AD_CLIENT_ID);
  return <LoginClient ssoEnabled={ssoEnabled} />;
}
