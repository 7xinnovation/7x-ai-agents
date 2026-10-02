import { registerAdapter } from "./registry";
import type { AdapterContext, PaymentAdapter } from "./types";

/**
 * UAEPay (noqodi) hosted-checkout adapter.
 *
 * Bind an agent's payment method to provider "uaepay" with:
 *   settings:    { baseUrl, merchantCode, returnUrl }
 *   secretRefs:  [UAEPAY_CLIENT_ID, UAEPAY_CLIENT_SECRET]
 *
 * Shape: ask for a payment link, send the customer to it, read the outcome back
 * from the inquiry API. That is `initiate` + `getStatus`, which is why this fits
 * the existing PaymentAdapter without changing anything downstream — the case
 * state machine, the pay-block fence, the receipt and the stuck-payment sweep
 * are all provider-agnostic already.
 *
 * WRITTEN AGAINST THE UAT, NOT AGAINST THE GUIDE. Four things the document gets
 * wrong or leaves out, each found by calling it on 2 October 2026:
 *
 *   1. `emiratesId` must be BARE DIGITS. The guide's own worked example,
 *      "784-1993-1234566", is rejected with INVALID_EMIRATESID. Sending the
 *      customer's Emirates ID as they or UAE PASS write it fails every payment.
 *   2. `merchantCode` is required on EVERY `transactions[]` line, not only at
 *      the top level — TRANSACTION_MERCHANT_CODE_REQUIRED.
 *   3. Two transaction lines carrying the SAME merchantCode are refused with
 *      DUPLICATE_MERCHANT. Splitting a payment into fee + surcharge lines needs
 *      distinct CHILD merchant codes, which we do not have. One line until we
 *      do, with the breakdown in `transactionRemarks`.
 *   4. The token lives 299 seconds. It is minted per call and never cached:
 *      a cached token is a payment that fails five minutes into a conversation.
 */

interface UpConfig {
  baseUrl: string;
  merchantCode: string;
  clientId: string;
  clientSecret: string;
  returnUrl?: string;
}

function cfgOf(ctx: AdapterContext): UpConfig {
  const baseUrl = ((ctx.settings.baseUrl as string) || ctx.secrets.UAEPAY_BASE_URL || "https://uat-api.uaepay.ae").replace(/\/$/, "");
  const merchantCode = (ctx.settings.merchantCode as string) || ctx.secrets.UAEPAY_MERCHANT_CODE || "";
  const clientId = ctx.secrets.UAEPAY_CLIENT_ID ?? "";
  const clientSecret = ctx.secrets.UAEPAY_CLIENT_SECRET ?? "";
  if (!merchantCode || !clientId || !clientSecret) throw new Error("UAEPay merchantCode / client credentials not configured");
  return { baseUrl, merchantCode, clientId, clientSecret, returnUrl: ctx.settings.returnUrl as string | undefined };
}

/**
 * A fresh token, every time.
 *
 * 299 seconds is shorter than a conversation and far shorter than the gap
 * between creating a link and asking what happened to it, so there is no window
 * in which caching this is both safe and worth the complexity.
 */
async function accessToken(cfg: UpConfig): Promise<string> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}/oauth/token/client-credentials`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; statusInfo?: { error?: { code?: string; message?: string } } } | null;
  const token = body?.access_token;
  if (!res.ok || !token) {
    const err = body?.statusInfo?.error;
    throw new Error(`UAEPay auth failed: ${res.status}${err?.code ? ` — ${err.code}: ${err.message ?? ""}` : ""}`);
  }
  return token;
}

/** Emirates ID as UAEPay will accept it: digits only. See note 1 above. */
export function uaePayEmiratesId(raw: unknown): string | undefined {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return /^\d{15}$/.test(digits) ? digits : undefined;
}

/** A mobile number as they take it: digits, country code included, no plus. */
export function uaePayMobile(raw: unknown): string | undefined {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  // 0501234567 -> 971501234567. A local number sent as-is is not a UAE number.
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `971${digits.slice(1)}`;
  if (digits.length === 9) digits = `971${digits}`;
  return /^\d{10,15}$/.test(digits) ? digits : undefined;
}

export const uaePayPayment: PaymentAdapter = {
  async initiate(ctx, input) {
    const cfg = cfgOf(ctx);
    /**
     * Checked before anything leaves this process.
     *
     * It used to sit after the token call, so a payment missing an Emirates ID
     * spent a round trip to find out what we already knew. Their own error
     * names the field but not the reason, and "invalid" on a number nobody
     * mistyped is a long afternoon. UAEPay is offered to signed-in customers
     * only, so an absent Emirates ID means the offer was made where it should
     * not have been — worth failing loudly and immediately over.
     */
    const emiratesId = uaePayEmiratesId(input.customer?.emiratesId);
    if (!emiratesId) {
      // Refused here rather than sent and rejected: their error names the field
      // but not the reason, and "invalid" on a 15-digit number nobody mistyped
      // is a long afternoon. UAEPay is offered to signed-in customers only, so
      // an absent Emirates ID means the offer was made where it should not be.
      throw new Error("UAEPay requires the customer's Emirates ID (15 digits) and this payment has none");
    }
    const token = await accessToken(cfg);
    /**
     * `merchantRequestId` is OUR per-attempt UUID and the key the inquiry API
     * is addressed by, so it becomes the payment's `reference` — that is what
     * getStatus, the return route and the reconcile sweep all carry. It must be
     * new on every attempt: reusing one returns TRANSACTION_ALREADY_INITIATED.
     *
     * `merchantOrderId` is the stable one — the case — so UAEPay can see three
     * reissued links as one payment for one application.
     */
    const merchantRequestId = crypto.randomUUID();
    const amount = Math.round(input.amount * 100) / 100;
    const res = await fetch(`${cfg.baseUrl}/v3/payments/token/createLinks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceType: "CREATE_LINK",
        merchantCode: cfg.merchantCode,
        source: "UAEPAY",
        paymentInitiator: {
          name: input.customer?.name || undefined,
          emiratesId,
          mobileNumber: uaePayMobile(input.customer?.mobile),
          email: input.email,
        },
        paymentLinksInfo: [
          {
            merchantLandingURL: cfg.returnUrl,
            merchantRequestId,
            merchantOrderId: input.caseId,
            amount,
            paymentRemarks: input.description.slice(0, 120),
            // ONE line, with its own merchantCode. See notes 2 and 3 above.
            transactions: [
              {
                merchantReferenceId: input.caseId,
                merchantCode: cfg.merchantCode,
                transactionRemarks: input.description.slice(0, 120),
                transactionAmount: amount,
              },
            ],
          },
        ],
      }),
    });

    /**
     * THEIR FAILURES COME BACK 200 WITH statusInfo.SUCCESS.
     *
     * A business rejection — a bad Emirates ID, a missing merchant code — is
     * reported per link inside `paymentLinksInfo[].error` while the envelope
     * says the REQUEST succeeded. Reading res.ok, or the top-level status, and
     * calling that a payment is how a customer gets a dead link.
     */
    const body = (await res.json().catch(() => null)) as {
      statusInfo?: { status?: string; error?: { code?: string; message?: string } };
      paymentLinksInfo?: { paymentUrl?: string; paymentRequestToken?: string; error?: { code?: string; message?: string } }[];
    } | null;
    const link0 = body?.paymentLinksInfo?.[0];
    const err = link0?.error ?? body?.statusInfo?.error;
    if (!res.ok || err || !link0?.paymentUrl) {
      throw new Error(
        `UAEPay create link failed: ${res.status}${err?.code ? ` — ${err.code}: ${err.message ?? ""}` : ""}`
      );
    }
    return { reference: merchantRequestId, link: link0.paymentUrl, status: "initiated" };
  },

  async getStatus(ctx, input) {
    const cfg = cfgOf(ctx);
    const token = await accessToken(cfg);
    const res = await fetch(
      `${cfg.baseUrl}/v2/inquiry/merchant/${encodeURIComponent(cfg.merchantCode)}/txn/${encodeURIComponent(input.reference)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    // A payment we cannot read is not a payment that failed. Anything other
    // than a clear answer leaves it where it was, for the sweep to ask again.
    if (!res.ok) return { status: "initiated" };
    const body = (await res.json().catch(() => null)) as { statusInfo?: { status?: string } } | null;
    const status = String(body?.statusInfo?.status ?? "").toUpperCase();
    if (status === "SUCCESS") return { status: "paid" };
    if (status === "FAILURE") return { status: "failed" };
    // INITIATED / PENDING, and anything they add later.
    return { status: "initiated" };
  },
};

export function registerUaePayAdapter() {
  registerAdapter("payment", "uaepay", () => uaePayPayment);
}
