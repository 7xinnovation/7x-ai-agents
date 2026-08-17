import { listIntegrations, type EnvKey, type EnvSpec } from "./integrations";
import { decryptSecret, isEncrypted } from "./crypto";

/**
 * Tell EPGL's Salesforce that a licence fee has been paid.
 *
 * Salesforce creates the Payment Advice, Invoice and Receipt itself — their team
 * was explicit that we should not create any of those. What it cannot know is
 * that the money arrived, because the customer pays through our gateway. Without
 * this call the Payment Advice sits unpaid however much the customer has paid,
 * and the licence request never reaches "Payment Verified".
 *
 * On success Salesforce creates a Payment_Notification__c against the request's
 * Payment Advice, sets the licence request to Payment Verified, marks the Advice
 * Paid with the summed transaction amount, and approves the Payment Items.
 *
 * Backed by their Apex REST resource:
 *   POST /services/apexrest/paymentNotification/
 *
 * TWO WIRE QUIRKS, from their spec. `currency` and `desc` are reserved words in
 * Apex and are remapped internally, so those exact keys must appear on the wire —
 * renaming them to something tidier would silently drop the values. And the 400
 * body still names a legacy `applicationId` element; the field it means is
 * `notifyPayment.salesforceId`.
 */

const INTEGRATION_NAME = /epgl.*salesforce/i;
const APEX_PATH = "/services/apexrest/paymentNotification/";

/** Salesforce record ids are 15 or 18 alphanumeric characters. */
const SF_ID = /^[a-zA-Z0-9]{15,18}$/;

export interface PaymentNotificationInput {
  /** Salesforce Id of the EPG_License_Request__c record. Mandatory. */
  licenseRequestId: string;
  /** Our payment reference — becomes the Payment_Notification__c name. */
  paymentId: string;
  amount: number;
  currency?: string;
  /** The gateway's own reference for the settled transaction. */
  transactionId?: string;
  /** When the gateway settled it. Defaults to now. */
  paidAt?: Date;
  paymentMethod?: string;
  payThru?: string;
}

export type PaymentNotificationResult =
  | { ok: true; status: number; correlationId?: string }
  | { ok: false; status: number; reason: string; retryable: boolean };

interface Creds { baseUrl: string; tokenUrl: string; clientId: string; clientSecret: string }

let cached: { token: string; at: number } | null = null;
const TOKEN_TTL_MS = 20 * 60_000;

async function creds(agentId: string, env: EnvKey): Promise<Creds> {
  const rows = await listIntegrations(agentId);
  const row = rows.find((r) => INTEGRATION_NAME.test(r.name) && r.environments[env]);
  const spec = row?.environments[env] as EnvSpec | undefined;
  if (!spec) throw new Error("EPGL Salesforce integration is not configured for this environment");
  const clientSecret = isEncrypted(spec.authValue) ? decryptSecret(spec.authValue) : spec.authValue;
  if (!spec.oauthClientId || !clientSecret || !spec.oauthTokenUrl) {
    throw new Error("EPGL Salesforce OAuth credentials are incomplete");
  }
  return {
    baseUrl: spec.baseUrl.replace(/\/$/, ""),
    tokenUrl: spec.oauthTokenUrl,
    clientId: spec.oauthClientId,
    clientSecret: clientSecret as string,
  };
}

async function token(c: Creds): Promise<string> {
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Salesforce token request failed (HTTP ${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Salesforce token response had no access_token");
  cached = { token: json.access_token, at: Date.now() };
  return json.access_token;
}

/**
 * Send the notification. Never throws — the caller is a payment webhook, and the
 * money has already moved by the time we get here. A failure to tell Salesforce
 * must not turn into a failed webhook that the gateway then retries against a
 * payment already settled on our side.
 *
 * `retryable` separates "Salesforce was unreachable or rejected our token" from
 * "this licence request does not exist", because only one of those is worth
 * sending again.
 */
export async function notifyEpglPayment(
  agentId: string,
  env: EnvKey,
  input: PaymentNotificationInput
): Promise<PaymentNotificationResult> {
  if (!SF_ID.test(String(input.licenseRequestId ?? "").trim())) {
    return { ok: false, status: 0, reason: "not a Salesforce licence request id", retryable: false };
  }

  let c: Creds;
  let bearer: string;
  try {
    c = await creds(agentId, env);
    bearer = await token(c);
  } catch (e) {
    return { ok: false, status: 0, reason: (e as Error).message, retryable: true };
  }

  const body = {
    entityId: "Emirates Post Group Licensing - AI Assistant",
    notifyPayment: {
      salesforceId: input.licenseRequestId.trim(),
      payment: {
        paymentId: input.paymentId,
        payOn: (input.paidAt ?? new Date()).toISOString(),
        payThru: input.payThru ?? "N-Genius",
        paymentMethod: input.paymentMethod ?? "CreditCard",
        paymentStatus: "completed",
        transactions: [
          {
            transactionId: input.transactionId ?? input.paymentId,
            amount: input.amount,
            // Reserved word in Apex, remapped their side — must be `currency`.
            currency: { en: input.currency ?? "AED", ar: "درهم" },
          },
        ],
      },
    },
  };

  const run = async (t: string) =>
    fetch(`${c.baseUrl}${APEX_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await run(bearer);
    if (res.status === 401) {
      cached = null; // token revoked or expired early — mint once more
      res = await run(await token(c));
    }
  } catch (e) {
    return { ok: false, status: 0, reason: `could not reach Salesforce: ${(e as Error).message}`, retryable: true };
  }

  const text = await res.text();
  let parsed: { status?: number; correlationId?: string; desc?: { en?: string }; message?: string } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep the raw text below */
  }

  // Their Apex answers 200 with a body that carries its own status, so a 200 is
  // not on its own proof it worked.
  if (res.ok && (parsed.status === undefined || parsed.status === 200)) {
    return { ok: true, status: res.status, correlationId: parsed.correlationId };
  }

  const reason =
    parsed.desc?.en ??
    (typeof parsed.message === "string" ? parsed.message : undefined) ??
    text.slice(0, 200) ??
    `HTTP ${res.status}`;
  const effective = parsed.status ?? res.status;
  return {
    ok: false,
    status: effective,
    reason,
    // 404 means the licence request id is wrong; sending it again will not help.
    retryable: effective !== 404 && effective !== 400,
  };
}
