import { listIntegrations, type EnvKey, type EnvSpec } from "./integrations";
import { decryptSecret, isEncrypted } from "./crypto";
import { trackedFetch } from "./apiCallLog";

/**
 * Taking the licence fee on the New Regulation (2.0) contract.
 *
 * Three calls, in this order, and the order is the whole point:
 *
 *   1. READY TO PAY. The composite, with the application id, its Product_Code
 *      and EPG_Request_Status__c = "Pending Payment". Reaching that status is
 *      what makes Salesforce raise the payment advice — NewRegulationRequestHook
 *      calls createPaymentAdvices on it, once, for the quoted fee.
 *   2. PRICE AGAIN. Until step 1 the quote carries refInvoiceId: null. After it,
 *      refInvoiceId is the advice number, which is what the payment is reported
 *      against. Verified on their sandbox on 27 October: LR-54066, still Draft,
 *      quotes 1,000 with refInvoiceId null; LR-54056, paid, quotes the same
 *      1,000 with refInvoiceId "P14226" and quotationStatus "Paid".
 *   3. NOTIFY, once the money has settled on our gateway.
 *
 * SKIPPING STEP 1 IS NOT A SLOWER PATH, IT IS A SILENT ONE. Their
 * PaymentNotification class marks `transactions[0]` of the licence request Paid
 * — and with no advice raised there is no transaction, so the notification
 * answers 200 having changed nothing. The application stays in Draft, nobody is
 * told, and the applicant has paid. That is why this is server-side, in one
 * place, rather than three instructions to a model.
 *
 * It is also why the application SUBMITS ITSELF here. On 1.x we set
 * "Payment Verified"; their class explicitly does not, for a new-regulation
 * request ("the Paid advice below takes it from Pending Payment to Submitted
 * and starts the pre-checks"). So nothing of ours should submit after payment,
 * and the guidance says so.
 *
 * Their org, their sandbox: this is the "EPGL New Regulation" integration (the
 * NewLaw org), NOT the "EPGL Salesforce" one that lib/epglPayment.ts talks to.
 * Two orgs, two contracts — notifyPayment keys on `applicationId` here and on
 * `salesforceId` there, and neither class binds the other's field.
 */

const INTEGRATION_NAME = /epgl.*new.*regulation/i;
const COMPOSITE_PATH = "/services/apexrest/CompositeHandler";
const PRICING_PATH = "/services/apexrest/payment/pricing";
const NOTIFY_PATH = "/services/apexrest/paymentNotification";

/** Salesforce's own application reference, the only key any of this uses. */
export const APPLICATION_ID = /^LR-\w+$/i;

/**
 * Where the advice number is kept between opening the card and the money
 * settling, which may be a different request, a different process and several
 * minutes apart. Re-priced if it is missing — the advice is stable once raised —
 * so losing it costs a round trip rather than the payment.
 */
export const EPGL_ADVICE_KEY = "__epgl_payment_advice";

export interface Epgl20Quote {
  /** The payment advice number, once one has been raised. Null before that. */
  adviceNumber: string | null;
  /** The sum of the quoted line items, in whatever currency they quoted. */
  amount: number;
  currency: string;
  /** Their word for where the quote stands: Approved, Paid, ... */
  status: string | null;
}

interface Creds { baseUrl: string; tokenUrl: string; clientId: string; clientSecret: string; agentId: string; env: EnvKey }

let cached: { token: string; at: number } | null = null;
const TOKEN_TTL_MS = 20 * 60_000;

async function creds(agentId: string, env: EnvKey): Promise<Creds> {
  const rows = await listIntegrations(agentId);
  const row = rows.find((r) => INTEGRATION_NAME.test(r.name) && r.environments[env]);
  const spec = row?.environments[env] as EnvSpec | undefined;
  if (!spec) throw new Error("EPGL New Regulation is not configured for this environment");
  const clientSecret = isEncrypted(spec.authValue) ? decryptSecret(spec.authValue) : spec.authValue;
  if (!spec.oauthClientId || !clientSecret || !spec.oauthTokenUrl) {
    throw new Error("EPGL New Regulation OAuth credentials are incomplete");
  }
  return {
    baseUrl: spec.baseUrl.replace(/\/$/, ""),
    tokenUrl: spec.oauthTokenUrl,
    clientId: spec.oauthClientId,
    clientSecret: clientSecret as string,
    agentId,
    env,
  };
}

async function token(c: Creds): Promise<string> {
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
  const res = await trackedFetch(
    c.tokenUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: c.clientId,
        client_secret: c.clientSecret,
      }).toString(),
    },
    { agentId: c.agentId, environment: c.env, integration: "EPGL New Regulation", tool: "epgl_newlaw_oauth_token" }
  );
  if (!res.ok) throw new Error(`Salesforce token request failed (HTTP ${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Salesforce token response had no access_token");
  cached = { token: json.access_token, at: Date.now() };
  return json.access_token;
}

async function post(c: Creds, path: string, body: unknown, tool: string): Promise<{ status: number; text: string }> {
  const run = async (t: string) =>
    trackedFetch(
      `${c.baseUrl}${path}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      },
      { agentId: c.agentId, environment: c.env, integration: "EPGL New Regulation", tool }
    );
  let res = await run(await token(c));
  if (res.status === 401) {
    cached = null;
    res = await run(await token(c));
  }
  return { status: res.status, text: await res.text() };
}

// ---------------------------------------------------------------- bodies
//
// Kept as exported pure functions so a test can assert the shape without a
// network, a token or their sandbox. Everything below them is transport.

/**
 * Step 1. The update that raises the advice.
 *
 * Product_Code is NOT decoration. CompositeHandler routes a licence-request item
 * down the new-law path only when NewRegulationApiAdapter.isNewLaw says so, and
 * that reads Product_Code (or the record type). Without it the item falls into
 * the LEGACY branch, which — for an application whose account already exists —
 * sets EPG_Request_Status__c to "Under document review" itself. So an update
 * missing the product code does not merely fail to raise an advice; it moves the
 * application somewhere nobody asked for.
 */
export function readyToPayBody(applicationId: string, productCode: string) {
  return {
    allOrNone: true,
    compositeRequest: [
      {
        method: "POST",
        url: "/services/data/v60.0/sobjects/EPG_License_Request__c",
        referenceId: "App",
        body: {
          applicationId__c: applicationId,
          Product_Code: productCode,
          EPG_Request_Status__c: "Pending Payment",
        },
      },
    ],
  };
}

/**
 * Step 2 (and step 0 — it is the same call that quoted the fee in the first
 * place).
 *
 * `infos: []` is carried because their Apex dereferences it: omitted or null it
 * answers 400 "Attempt to de-reference a null object", whatever their spec says
 * about it being optional. Narrowed field by field on 26 October; see the note
 * on the same workaround in lib/integrations.ts.
 */
export function pricingBody(applicationId: string) {
  return {
    entityId: "EPG Portal",
    quotationRequest: {
      requestOn: new Date().toISOString(),
      appIdentifier: {
        applicationId,
        serviceId: "LICENSING",
        serviceVersion: "1.0",
        serviceName: { en: "Licence application", ar: "طلب رخصة" },
        serviceType: { code: "NEWREG", en: "New regulation licence", ar: "رخصة" },
        requestType: "New",
      },
      payType: "PayToSubmit",
      infos: [],
    },
  };
}

export interface Epgl20NotifyInput {
  applicationId: string;
  /** The advice number from pricing (refInvoiceId). */
  adviceNumber: string;
  amount: number;
  currency?: string;
  /** Our payment reference. Their class uses it as the record's Name. */
  paymentId: string;
  transactionId?: string;
  paidAt?: Date;
  paymentMethod?: string;
  payThru?: string;
}

/**
 * Step 3. The gateway result.
 *
 * `currency` is spelled plainly here, NOT `responseCurrency` as on 1.x: their
 * PaymentNotification class rewrites the raw JSON ("currency" -> "responseCurrency")
 * before deserialising, because currency is a reserved word in Apex. Sending
 * their 1.x spelling into this org would arrive as a field their wrapper has no
 * slot for, and the amount's currency would go nowhere — the same bug we already
 * had once, from the other end.
 *
 * `transactions` must be present and non-empty: the class calls isEmpty() on it
 * without a null check, and the resulting exception is caught and returned as a
 * flat 400.
 */
export function notifyBody(input: Epgl20NotifyInput) {
  return {
    entityId: "Emirates Post Group Licensing - AI Assistant",
    notifyPayment: {
      applicationId: input.applicationId,
      payment: {
        invoiceId: input.adviceNumber,
        refInvoiceId: input.adviceNumber,
        paymentId: input.paymentId,
        payOn: (input.paidAt ?? new Date()).toISOString(),
        payBy: "Applicant",
        payThru: input.payThru ?? "Online",
        paymentMethod: input.paymentMethod ?? "Card (online)",
        paymentStatus: "Paid",
        transactions: [
          {
            transactionId: input.transactionId ?? input.paymentId,
            refTransactionId: input.transactionId ?? input.paymentId,
            itemId: "",
            beneficiaryId: "EPG",
            amount: input.amount,
            currency: { en: input.currency ?? "AED", ar: "درهم" },
          },
        ],
      },
      message: { code: "0", en: "Payment successful", ar: "تم الدفع" },
      infos: [],
    },
  };
}

/** The quote, out of their envelope. Null when the answer was not one. */
export function quoteFrom(text: string): Epgl20Quote | null {
  let parsed: { quotationResponse?: Record<string, unknown> } | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const q = parsed?.quotationResponse;
  if (!q || typeof q !== "object") return null;
  const items = Array.isArray(q.items) ? (q.items as Record<string, unknown>[]) : [];
  // totalAmount is the line's own total (quantity included); `amount` is the
  // unit price. Summing the wrong one quotes a multi-site licence short.
  const amount = items.reduce((s, i) => s + (typeof i.totalAmount === "number" ? i.totalAmount : 0), 0);
  const currency = items
    .map((i) => (i.currency as { en?: string } | undefined)?.en)
    .find((c): c is string => typeof c === "string" && c.length > 0);
  const advice = typeof q.refInvoiceId === "string" && q.refInvoiceId.trim() ? q.refInvoiceId.trim() : null;
  return {
    adviceNumber: advice,
    amount,
    currency: currency ?? "AED",
    status: typeof q.quotationStatus === "string" ? q.quotationStatus : null,
  };
}

/** Every item of a composite response succeeded. */
export function compositeAccepted(text: string): boolean {
  try {
    const j = JSON.parse(text) as { compositeResponse?: { body?: { success?: boolean } }[] };
    const items = j.compositeResponse ?? [];
    return items.length > 0 && items.every((i) => i.body?.success === true);
  } catch {
    return false;
  }
}

/** The first error their composite reported, for a log or a refusal. */
export function compositeError(text: string): string {
  try {
    const j = JSON.parse(text) as { compositeResponse?: { body?: { errors?: { message?: string }[] } }[] };
    for (const item of j.compositeResponse ?? []) {
      const msg = item.body?.errors?.find((e) => e.message)?.message;
      if (msg) return msg;
    }
  } catch {
    /* fall through to the raw text */
  }
  return text.slice(0, 300);
}

// ---------------------------------------------------------------- calls

export async function priceApplication(
  agentId: string,
  env: EnvKey,
  applicationId: string
): Promise<Epgl20Quote | null> {
  if (!APPLICATION_ID.test(applicationId)) return null;
  const c = await creds(agentId, env);
  const { status, text } = await post(c, PRICING_PATH, pricingBody(applicationId), "epgl_newlaw_pricing");
  if (status !== 200) return null;
  return quoteFrom(text);
}

export type ReadyToPayResult =
  | { ok: true; quote: Epgl20Quote }
  | { ok: false; reason: string; alreadyPaid?: boolean };

/**
 * Move the application to Pending Payment and come back with the advice.
 *
 * Safe to call twice. An application already in Pending Payment stays there and
 * createPaymentAdvices skips it — it looks for an open advice first — so a
 * customer who reloads the payment page does not collect a second invoice.
 */
export async function readyToPay(
  agentId: string,
  env: EnvKey,
  applicationId: string,
  productCode: string
): Promise<ReadyToPayResult> {
  if (!APPLICATION_ID.test(applicationId)) return { ok: false, reason: "not a new-regulation application id" };
  if (!productCode.trim()) return { ok: false, reason: "the application's product code is not on the case" };

  let c: Creds;
  try {
    c = await creds(agentId, env);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  // Already settled? Then nothing here may run again: the update would be a
  // no-op but the question is worth asking BEFORE a second card is opened.
  const before = await post(c, PRICING_PATH, pricingBody(applicationId), "epgl_newlaw_pricing").catch(() => null);
  if (before?.status === 200) {
    const q = quoteFrom(before.text);
    if (q && /paid/i.test(q.status ?? "")) {
      return { ok: false, reason: "Salesforce already holds this application's fee as paid", alreadyPaid: true };
    }
  }

  const moved = await post(c, COMPOSITE_PATH, readyToPayBody(applicationId, productCode.trim()), "epgl_newlaw_ready_to_pay");
  if (moved.status !== 200 || !compositeAccepted(moved.text)) {
    return { ok: false, reason: compositeError(moved.text) };
  }

  const after = await post(c, PRICING_PATH, pricingBody(applicationId), "epgl_newlaw_pricing");
  if (after.status !== 200) return { ok: false, reason: `pricing answered HTTP ${after.status}` };
  const quote = quoteFrom(after.text);
  if (!quote) return { ok: false, reason: "pricing answered without a quotation" };
  if (!quote.adviceNumber) {
    // The status moved and no advice came back. Their hook skips an application
    // whose Fee_Quote_Total__c is null or zero, so this is a priced-at-nothing
    // application rather than a transport failure, and charging it would be
    // charging for something their own fee calculator says is free.
    return { ok: false, reason: "Salesforce raised no payment advice for this application" };
  }
  if (quote.amount <= 0) return { ok: false, reason: "the quote came back at zero" };
  return { ok: true, quote };
}

export type NotifyResult =
  | { ok: true; status: number }
  | { ok: false; status: number; reason: string; retryable: boolean };

export async function notifyPayment(
  agentId: string,
  env: EnvKey,
  input: Epgl20NotifyInput
): Promise<NotifyResult> {
  if (!APPLICATION_ID.test(input.applicationId)) {
    return { ok: false, status: 0, reason: "not a new-regulation application id", retryable: false };
  }
  let c: Creds;
  try {
    c = await creds(agentId, env);
  } catch (e) {
    return { ok: false, status: 0, reason: (e as Error).message, retryable: true };
  }

  let status: number;
  let text: string;
  try {
    ({ status, text } = await post(c, NOTIFY_PATH, notifyBody(input), "epgl_newlaw_payment_notify"));
  } catch (e) {
    return { ok: false, status: 0, reason: `could not reach Salesforce: ${(e as Error).message}`, retryable: true };
  }

  // Their class answers 200 carrying its own status, so a 200 alone proves
  // nothing — the same shape as 1.x, and the same reason for checking.
  let parsed: { status?: number; message?: string; desc?: { en?: string } } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep the raw text for the reason */
  }
  if (status === 200 && (parsed.status === undefined || parsed.status === 200)) return { ok: true, status };

  const effective = parsed.status ?? status;
  const reason = parsed.desc?.en ?? parsed.message ?? text.slice(0, 200) ?? `HTTP ${status}`;
  return { ok: false, status: effective, reason, retryable: effective !== 404 && effective !== 400 };
}
