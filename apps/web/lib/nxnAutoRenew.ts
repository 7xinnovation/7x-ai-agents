/**
 * Auto-renewal, set explicitly rather than hoped for.
 *
 * Rental/Save carries `isAutomaticSubscriptionEnabled`, and the customer's toggle
 * has been going into it since the journey was built. It does not decide the
 * box's auto-renewal: box 450294 was rented with the toggle ON and the portal
 * shows the box's own switch OFF. The portal never relies on the save either —
 * its switch calls UpdateAutoRenewConfig, and that is the only call that moves it.
 *
 * Two values are needed and neither is known at rental time: the box's
 * `uniqueBoxId` and the customer's `custProfId`. Both come back from
 * Renewal/Details once the box exists, so the read is done here rather than asked
 * of the model, which has no way to tell those fields from the dozens beside them.
 *
 * As with lib/gsbLookup, the request is templated here: the model supplies a box
 * number, an emirate and a yes/no, all validated below.
 */
import { listIntegrations, type EnvKey, type EnvSpec } from "./integrations";
import { decryptSecret, isEncrypted } from "./crypto";

const INTEGRATION_NAME = /nxn/i;
const BOX_NO = /^\d{3,12}$/;
const EMIRATE = /^[A-Za-z]{3}$/;

export type AutoRenewResult =
  | { ok: true; changed: boolean; enabled: boolean }
  | { ok: false; reason: "no_box" | "no_profile" | "rejected"; detail: string };

async function spec(agentId: string, env: EnvKey) {
  const rows = await listIntegrations(agentId);
  const row = rows.find((r) => INTEGRATION_NAME.test(r.name) && r.environments[env]);
  const s = row?.environments[env] as EnvSpec | undefined;
  if (!s) throw new Error("NXN integration is not configured for this environment");
  const apiKey = isEncrypted(s.apiKey) ? decryptSecret(s.apiKey) : s.apiKey;
  return { baseUrl: String(s.baseUrl).replace(/\/$/, ""), apiKey: (apiKey as string) || undefined };
}

function headers(apiKey: string | undefined, token: string) {
  const h: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
  if (apiKey) h["X-API-KEY"] = apiKey;
  return h;
}

/** What Emirates Post currently holds for a box, as the portal's own panel reads it. */
export async function boxConfig(
  agentId: string,
  env: EnvKey,
  boxNumber: string,
  emirateCode: string,
  token: string
): Promise<{ uniqueBoxId?: string; custProfId?: string; autoRenew?: boolean } | null> {
  if (!BOX_NO.test(boxNumber) || !EMIRATE.test(emirateCode)) return null;
  const s = await spec(agentId, env);
  const url = new URL(`${s.baseUrl}/api/Renewal/Details`);
  url.searchParams.set("BoxNumber", boxNumber);
  url.searchParams.set("EmirateCode", emirateCode.toUpperCase());
  const res = await fetch(url, { headers: headers(s.apiKey, token) });
  if (!res.ok) return null;
  const body = (await res.json()) as { payload?: Record<string, any> };
  // The record sits one level further down than the field names suggest:
  // payload.poBoxRenewalDetails.poBoxDetails, not payload.poBoxDetails. Reading
  // the shallower shape found nothing and reported the box as having no profile.
  const p = body?.payload?.poBoxRenewalDetails ?? body?.payload;
  if (!p) return null;
  return {
    uniqueBoxId: p.poBoxDetails?.uniqueBoxId ? String(p.poBoxDetails.uniqueBoxId) : undefined,
    custProfId: p.poBoxAddressDetails?.custProfId ? String(p.poBoxAddressDetails.custProfId) : undefined,
    autoRenew:
      typeof p.poBoxDetails?.isAutoRenewEnabled === "boolean" ? p.poBoxDetails.isAutoRenewEnabled : undefined,
  };
}

export async function setAutoRenew(
  agentId: string,
  env: EnvKey,
  boxNumber: string,
  emirateCode: string,
  enabled: boolean,
  token: string
): Promise<AutoRenewResult> {
  const cfg = await boxConfig(agentId, env, boxNumber, emirateCode, token);
  if (!cfg) return { ok: false, reason: "no_box", detail: `Emirates Post returned no record for box ${boxNumber} in ${emirateCode}.` };
  if (!cfg.uniqueBoxId || !cfg.custProfId) {
    return { ok: false, reason: "no_profile", detail: "The box record carries no customer profile id, so auto-renewal cannot be set for it." };
  }
  if (cfg.autoRenew === enabled) return { ok: true, changed: false, enabled };

  const s = await spec(agentId, env);
  const res = await fetch(`${s.baseUrl}/api/UpdateAutoRenewConfig`, {
    method: "POST",
    headers: { ...headers(s.apiKey, token), "Content-Type": "application/json" },
    body: JSON.stringify({
      requestSource: "PoBoxAIBot",
      custProfId: cfg.custProfId,
      uniqueBoxId: cfg.uniqueBoxId,
      isAutoReNewEnabled: enabled,
    }),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    return { ok: false, reason: "rejected", detail: `HTTP ${res.status} ${text}` };
  }
  return { ok: true, changed: true, enabled };
}
