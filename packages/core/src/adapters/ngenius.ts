import { registerAdapter } from "./registry";
import type { AdapterContext, PaymentAdapter } from "./types";

/**
 * Network International (N-Genius) payment gateway adapter (PRD: Network
 * International payment processing; Dialog never stores card data — it creates a
 * hosted-payment order and reconciles via order status + webhook). Credential-
 * activated — bind an agent's payment integration to provider "ngenius" with:
 *   settings: { baseUrl, outletRef }
 *   secretRefs: [NGENIUS_API_KEY]
 * Amounts are whole-currency in the case; N-Genius expects minor units (×100).
 */

interface NgConfig {
  baseUrl: string;
  outletRef: string;
  apiKey: string;
}

function cfgOf(ctx: AdapterContext): NgConfig {
  const baseUrl = (ctx.settings.baseUrl as string) || ctx.secrets.NGENIUS_BASE_URL || "https://api-gateway.ngenius-payments.com";
  const outletRef = (ctx.settings.outletRef as string) || ctx.secrets.NGENIUS_OUTLET_REF || "";
  const apiKey = ctx.secrets.NGENIUS_API_KEY ?? "";
  if (!outletRef || !apiKey) throw new Error("N-Genius outletRef / API key not configured");
  return { baseUrl, outletRef, apiKey };
}

/** A gateway-acceptable email, or nothing. */
function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

async function accessToken(cfg: NgConfig): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/identity/auth/access-token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${cfg.apiKey}`,
      "Content-Type": "application/vnd.ni-identity.v1+json",
      Accept: "application/vnd.ni-identity.v1+json",
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`N-Genius auth failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export const ngeniusPayment: PaymentAdapter = {
  async initiate(ctx, input) {
    const cfg = cfgOf(ctx);
    const token = await accessToken(cfg);
    const res = await fetch(`${cfg.baseUrl}/transactions/outlets/${cfg.outletRef}/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.ni-payment.v2+json",
        Accept: "application/vnd.ni-payment.v2+json",
      },
      body: JSON.stringify({
        action: "SALE",
        amount: { currencyCode: input.currency, value: Math.round(input.amount * 100) },
        merchantOrderReference: input.caseId,
        // ONLY a real address. This used to be input.userRef — an identity, not
        // an email — and N-Genius rejects anything else with 422 "must be a
        // well-formed email address", killing the payment at the end of the
        // journey. Omitting it is accepted; guessing is not.
        emailAddress: isEmail(input.email) ? input.email : undefined,
        merchantAttributes: { redirectUrl: (ctx.settings.redirectUrl as string) || undefined },
      }),
    });
    if (!res.ok) {
      // Carry the gateway's own reason: a bare status told us nothing when this
      // failed in production and the payload had to be reconstructed by hand.
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`N-Genius create order failed: ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    const order = (await res.json()) as {
      reference: string;
      _links?: { payment?: { href?: string }; "payment-authorization"?: { href?: string } };
    };
    const link = order._links?.payment?.href;
    return { reference: order.reference, link, status: "initiated" };
  },

  async getStatus(ctx, input) {
    const cfg = cfgOf(ctx);
    const token = await accessToken(cfg);
    const res = await fetch(`${cfg.baseUrl}/transactions/outlets/${cfg.outletRef}/orders/${input.reference}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.ni-payment.v2+json" },
    });
    if (!res.ok) return { status: "initiated" };
    const order = (await res.json()) as { _embedded?: { payment?: { state?: string }[] } };
    const state = order._embedded?.payment?.[0]?.state ?? "";
    if (["PURCHASED", "CAPTURED", "PAID"].includes(state)) return { status: "paid" };
    if (["FAILED", "DECLINED", "REVERSED"].includes(state)) return { status: "failed" };
    return { status: "initiated" };
  },
};

export function registerNgeniusAdapter() {
  registerAdapter("payment", "ngenius", () => ngeniusPayment);
}
