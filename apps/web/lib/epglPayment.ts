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
 * WIRE QUIRKS, from their spec. `desc` is a reserved word in Apex and is
 * remapped internally, so that exact key must appear on the wire — renaming it
 * to something tidier would silently drop the value.
 *
 * The currency is the same quirk from the other end, and we had it backwards.
 * Contract 2.0.0, 15 September: "Note the name. The REQUEST field is
 * 'responseCurrency' — that is what the deployed Apex binds. The endpoint
 * renames it to 'currency' on the way OUT, so a response shows 'currency' while
 * a request must send 'responseCurrency'." We had been sending `currency`,
 * which their class does not bind: the notification succeeded and the currency
 * went nowhere.
 *
 * The record key is `notifyPayment.salesforceId`, which their 2.0.0 note
 * confirms and pins: the deployed PaymentNotification.cls binds only
 * `salesforceId` and `applicationId`, and the `licenseRequestSalesforceId` an
 * earlier draft of their contract named was never implemented. A 400 body still
 * mentions `applicationId`; the field it means for us is `salesforceId`.
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
/**
 * IS THERE ANYTHING TO NOTIFY AGAINST YET?
 *
 * The contract says this call "marks its payment advice (EPG_Transaction__c,
 * record type Invoice) as Paid with the summed transaction amounts". It says
 * nothing about what happens when there is no advice, and PreProd2 answered
 * that on 21 September: the request goes to Payment Verified and, two seconds
 * later, their workflow takes it to Closed — before anyone has reviewed it.
 *
 * Checked across six days of submissions, and the split is total rather than
 * incidental:
 *
 *   S-EPG-000003 (renewal)      5 of 5 carry an advice, raised one second
 *                               after the request, for AED 100,000
 *   S-EPG-000002 (new licence) 13 of 13 carry NONE
 *
 * So a renewal is payable the moment it exists and a new licence is not —
 * which matches their own sequencing note, that the advice is marked Paid
 * "after the request has been approved by the Business Team". We were
 * notifying about forty seconds after submission, long before any of that.
 *
 * Returns null when the question could not be answered, which the caller treats
 * as "not yet" rather than "go ahead": the sweep will ask again, and a
 * notification that arrives late is recoverable where one that closes an
 * unreviewed application is not.
 */
export async function paymentAdviceExists(
  agentId: string,
  env: EnvKey,
  licenseRequestId: string
): Promise<boolean | null> {
  const id = String(licenseRequestId ?? "").trim();
  if (!SF_ID.test(id)) return null;
  try {
    const c = await creds(agentId, env);
    const bearer = await token(c);
    // Fixed statement, one substituted value, already shape-checked above.
    const soql = `SELECT Id FROM EPG_Transaction__c WHERE EPG_License_Request__c = '${id}' LIMIT 1`;
    const res = await fetch(`${c.baseUrl}/services/data/v62.0/query?q=${encodeURIComponent(soql)}`, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { records?: unknown[] };
    return (j.records ?? []).length > 0;
  } catch {
    return null;
  }
}

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
            // NOT `currency`: their Apex binds `responseCurrency` on the way in
            // and renames it to `currency` in the response. See above.
            responseCurrency: { en: input.currency ?? "AED", ar: "درهم" },
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

/**
 * Tell EPGL Salesforce a licence fee has settled, from wherever we found out.
 *
 * This used to live in the webhook, and only the webhook, which meant it only
 * ran when N-Genius called us. It is not the only way a payment is confirmed:
 * the client polls /api/payments/status while the customer is on the payment
 * page, and the reconcile sweep catches whatever is left. Both of those mark the
 * payment paid on our side and neither told Salesforce.
 *
 * LR-37324 is what that looks like. Submitted 07:39:46, paid 07:40:29 by card on
 * the sandbox gateway, detected by the polling probe rather than the webhook --
 * and the licence request still read "Under document review" with a lastUpdated
 * of the submission, because nothing had touched it since. The money was ours
 * and Salesforce did not know.
 *
 * Idempotent by audit: it refuses to notify twice for the same payment
 * reference, so the probe and the webhook racing each other is harmless.
 *
 * Best-effort throughout. The money has already moved by the time this runs, so
 * a Salesforce problem must never fail the caller -- a webhook that 500s gets
 * the payment retried against an order that is already settled. Every outcome is
 * audited, so an unnotified payment is visible rather than silent.
 */
export async function notifyEpglIfLicenceFee(
  agentId: string,
  conversationId: string,
  reference: string,
  amount: number
): Promise<void> {
  try {
    const { getAgentById } = await import("./agents");
    const { getCase, audit, auditSeen } = await import("./conversation");

    const agent = await getAgentById(agentId);
    if (!agent || agent.definition.tenantSlug !== "epgl") return;

    // Already done, by whichever path got there first.
    if (await auditSeen(conversationId, "epgl_payment_notified", reference)) return;

    const c = await getCase(conversationId);
    // The licence request's Salesforce id is the case reference once submitted.
    // Before submission there is nothing to notify against, which is normal:
    // the request always exists first, and request_payment enforces it.
    const licenseRequestId = String(c?.state.reference ?? "").trim();
    if (!licenseRequestId) return;

    const env = agent.definition.activeEnvironment ?? "production";

    /**
     * NOTIFY, AND RECORD WHETHER THERE WAS AN ADVICE TO MARK.
     *
     * This used to hold the notification back when no payment advice existed,
     * to stop their workflow closing an unreviewed application two seconds
     * later. It worked, and it bought the wrong thing: a licence request that
     * has been PAID now sits at "Under document review" for ever, because
     * Salesforce is never told the money arrived. Raised on 24 September — the
     * status should be Payment Verified.
     *
     * Which the notification is what produces. The premature close is EPGL's
     * own Payment Verified -> Closed automation, added to their org between 16
     * and 21 September; it is theirs to gate on a review, and withholding a true
     * fact from their system of record is not our way to gate it. A payment that
     * is never reported is worse than a status that moves too fast: one is a
     * reconciliation nobody can do, the other is a workflow they can change.
     *
     * The advice is still READ, because whether one existed is the difference
     * between "marked an invoice paid" and "reported a payment against nothing",
     * and that distinction is what told us renewals differ from new licences.
     * It is recorded, not obeyed.
     */
    const advice = await paymentAdviceExists(agent.id, env, licenseRequestId);

    const res = await notifyEpglPayment(agent.id, env, {
      licenseRequestId,
      paymentId: reference,
      amount,
      currency: "AED",
    });

    await audit({
      agentId,
      conversationId,
      actor: "system",
      action: res.ok ? "epgl_payment_notified" : "epgl_payment_notify_failed",
      payload: res.ok
        ? { reference, licenseRequestId, correlationId: res.correlationId, adviceExisted: advice }
        : { reference, licenseRequestId, status: res.status, reason: res.reason, retryable: res.retryable, adviceExisted: advice },
    });
  } catch (e) {
    const { audit } = await import("./conversation");
    await audit({
      agentId,
      conversationId,
      actor: "system",
      action: "epgl_payment_notify_failed",
      payload: { reference, reason: e instanceof Error ? e.message : "unknown error", retryable: true },
    });
  }
}
