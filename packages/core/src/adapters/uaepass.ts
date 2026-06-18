import { registerAdapter } from "./registry";
import type { AdapterContext, AuthAdapter } from "./types";

/**
 * UAE PASS identity adapter (PRD: UAE PASS is the source of truth for customer
 * identity; Dialog never mints its own identity). OIDC auth-code flow.
 * Credential-activated — bind an agent's auth integration to provider "uaepass"
 * with:
 *   settings: { baseUrl, redirectUri, scope? }   (baseUrl e.g. https://stg-id.uaepass.ae or https://id.uaepass.ae)
 *   secretRefs: [UAEPASS_CLIENT_ID, UAEPASS_CLIENT_SECRET]
 * Note: Dialog only consumes an already-authenticated UAE PASS *session* in the
 * embed path (token passthrough). This adapter implements the full server-side
 * OIDC flow for deployments that drive sign-in directly.
 */

interface UpConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

function cfgOf(ctx: AdapterContext): UpConfig {
  const baseUrl = (ctx.settings.baseUrl as string) || "https://id.uaepass.ae";
  const clientId = ctx.secrets.UAEPASS_CLIENT_ID ?? "";
  const clientSecret = ctx.secrets.UAEPASS_CLIENT_SECRET ?? "";
  const redirectUri = (ctx.settings.redirectUri as string) || "";
  const scope = (ctx.settings.scope as string) || "urn:uae:digitalid:profile:general";
  if (!clientId || !clientSecret || !redirectUri) throw new Error("UAE PASS client credentials / redirectUri not configured");
  return { baseUrl, clientId, clientSecret, redirectUri, scope };
}

export const uaePassAuth: AuthAdapter = {
  getAuthorizationUrl(ctx, input) {
    const cfg = cfgOf(ctx);
    const url = new URL(`${cfg.baseUrl}/idshub/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("scope", cfg.scope);
    url.searchParams.set("state", input.state);
    url.searchParams.set("acr_values", "urn:safelayer:tws:policies:authentication:level:low");
    return url.toString();
  },

  async exchangeCode(ctx, input) {
    const cfg = cfgOf(ctx);
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    const tokenRes = await fetch(`${cfg.baseUrl}/idshub/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: cfg.redirectUri }),
    });
    if (!tokenRes.ok) throw new Error(`UAE PASS token exchange failed: ${tokenRes.status}`);
    const tokens = (await tokenRes.json()) as { access_token: string };

    const userRes = await fetch(`${cfg.baseUrl}/idshub/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userRes.ok) throw new Error(`UAE PASS userinfo failed: ${userRes.status}`);
    const u = (await userRes.json()) as { sub?: string; uuid?: string; fullnameEN?: string; firstnameEN?: string; lastnameEN?: string; email?: string; acr?: string; idn?: string };
    const name = u.fullnameEN || [u.firstnameEN, u.lastnameEN].filter(Boolean).join(" ") || undefined;
    return { userRef: u.sub || u.uuid || u.idn || "", name, company: undefined };
  },
};

export function registerUaePassAdapter() {
  registerAdapter("auth", "uaepass", () => uaePassAuth);
}
