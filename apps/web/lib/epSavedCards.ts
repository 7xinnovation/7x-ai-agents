/**
 * The cards a signed-in customer already has on file.
 *
 * Emirates Post keeps them, and their portal checks before it offers a payment
 * page: a customer with a saved card is asked whether to use it, not asked for
 * their number again. It is also what auto-renewal runs on — the portal refuses
 * to enable auto-renew when getcards comes back empty, because there is nothing
 * for it to charge.
 *
 * Read-only, and only ever for the customer whose own session token is passed.
 */
import { listIntegrations, type EnvKey, type EnvSpec } from "./integrations";
import { decryptSecret, isEncrypted } from "./crypto";

const INTEGRATION_NAME = /nxn/i;

export interface SavedCard {
  /** "*****1111" — already masked by Emirates Post. */
  maskedPan?: string;
  scheme?: string;
  /** "2030-12". */
  expiry?: string;
  cardholderName?: string;
  isDefault?: boolean;
  isExpired?: boolean;
  /** Opaque; goes back on paymentProperties.savedCard, never shown. */
  cardToken?: string;
}

export async function savedCards(agentId: string, env: EnvKey, token: string): Promise<SavedCard[]> {
  if (!token) return [];
  const rows = await listIntegrations(agentId);
  const row = rows.find((r) => INTEGRATION_NAME.test(r.name) && r.environments[env]);
  const spec = row?.environments[env] as EnvSpec | undefined;
  if (!spec) return [];
  const apiKey = isEncrypted(spec.apiKey) ? decryptSecret(spec.apiKey) : spec.apiKey;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const h: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
    if (apiKey) h[spec.apiKeyHeader || "X-API-KEY"] = String(apiKey);
    const res = await fetch(`${String(spec.baseUrl).replace(/\/$/, "")}/users/api/Payments/getcards`, {
      headers: h,
      signal: ctl.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { payload?: Record<string, unknown>[] };
    return (body?.payload ?? []).map((c) => ({
      maskedPan: typeof c.maskedPan === "string" ? c.maskedPan : undefined,
      scheme: typeof c.scheme === "string" ? c.scheme : undefined,
      expiry: typeof c.expiry === "string" ? c.expiry : undefined,
      cardholderName: typeof c.cardholderName === "string" ? c.cardholderName : undefined,
      isDefault: c.isDefault === true,
      isExpired: c.isExpired === true,
      cardToken: typeof c.cardToken === "string" ? c.cardToken : undefined,
    }));
  } catch {
    // A card list we cannot read is not a payment problem: the customer just
    // gets the normal checkout.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** How a card reads to a customer: "Visa ending 1111, expires 12/2030". */
export function describeCard(c: SavedCard): string {
  const last4 = (c.maskedPan ?? "").replace(/\D/g, "").slice(-4);
  const exp = /^\d{4}-\d{2}$/.test(c.expiry ?? "") ? `${c.expiry!.slice(5)}/${c.expiry!.slice(0, 4)}` : c.expiry;
  return [
    c.scheme ? c.scheme.charAt(0) + c.scheme.slice(1).toLowerCase() : "Card",
    last4 ? `ending ${last4}` : "",
    exp ? `expires ${exp}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}
