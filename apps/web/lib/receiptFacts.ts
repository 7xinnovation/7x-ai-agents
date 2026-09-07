import { getDb, auditLog } from "@dialog/db";
import { and, eq, inArray, desc } from "drizzle-orm";

/**
 * What actually happened, for the receipt.
 *
 * The case carries almost nothing after a renewal — a box number and a period —
 * so a receipt built from it named neither the subscriber, nor the bundle, nor
 * the date the box now runs to, and called a renewal "PO Box management" because
 * that was the journey the customer happened to start in.
 *
 * Emirates Post's own responses carry all of it. The confirmation returns the
 * box, the emirate, the branch, the bundle description and the new expiry; the
 * save that preceded it carries the subscriber's name. Both are already in the
 * audit log, written when the calls were made. So the receipt reads them back
 * rather than asking the case to have remembered.
 *
 * Nothing here is computed or inferred: a fact missing from the responses is
 * left off the receipt.
 */
export interface ReceiptFacts {
  customerName?: string;
  bundle?: string;
  /** The date the box now runs to, ISO. */
  expiry?: string;
  poBox?: string;
  emirate?: string;
  branch?: string;
  /** Emirates Post's own order number for the transaction. */
  orderNo?: string;
  /** What was actually done, whatever journey the customer started in. */
  operation?: "renewal" | "rental";
}

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s ? s : undefined;
};

/**
 * The first complete JSON object in a stored response.
 *
 * An audited response is not JSON: it is "HTTP 200 OK", then the body, then
 * whatever guidance was appended for the model ("DO NOT LINK AN INVOICE FROM
 * THIS RESPONSE…"). Parsing from the first brace to the end therefore fails on
 * every response that carries a note — which is most of the ones worth reading —
 * so the object's own closing brace has to be found. Braces inside strings do
 * not count, and an escaped quote does not end a string.
 */
export function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** "12/20/2034 00:00:00" and "2034-12-20T00:00:00" both mean the same day. */
function isoDay(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : undefined;
}

/** The name on the subscription, however that call happened to spell it. */
function nameIn(body: Record<string, unknown> | undefined): string | undefined {
  if (!body) return undefined;
  const profile = body.userProfile as Record<string, unknown> | undefined;
  const kyc = body.customerKYC as Record<string, unknown> | undefined;
  const billing = (body.paymentProperties as Record<string, unknown> | undefined)?.billingDetail as
    | Record<string, unknown>
    | undefined;
  const full = str(profile?.customerNameEN);
  if (full) return full;
  for (const src of [kyc, billing]) {
    const first = str(src?.firstName);
    const last = str(src?.lastName);
    if (first || last) return [first, last].filter(Boolean).join(" ");
  }
  return undefined;
}

/** One audited integration call, as much of it as this needs. */
export interface AuditedCall {
  path?: string;
  input?: { body?: Record<string, unknown> };
  response?: string;
}

/**
 * Read the transaction out of the calls that made it.
 *
 * Newest first, and an older row never overwrites what a newer one said: a
 * customer who renewed twice in one conversation gets the second renewal.
 */
export function factsFromRows(rows: AuditedCall[]): ReceiptFacts {
  const facts: ReceiptFacts = {};
  for (const p of rows) {
    const path = String(p.path ?? "");
    const body = p.input?.body;

    if (/renewal\/save/i.test(path)) facts.operation ??= "renewal";
    else if (/rental\/save/i.test(path)) facts.operation ??= "rental";

    if (body) {
      facts.customerName ??= nameIn(body);
      facts.expiry ??= isoDay(body.expiryDate ?? body.poBoxExpiryDate);
      facts.poBox ??= str(body.boxNumber);
      facts.emirate ??= str(body.emirateCode);
    }

    // The confirmation is the authority on what the subscription now IS, so it
    // is allowed to overwrite what the request asked for.
    if (p.response && /confirmpayment|updatepayment/i.test(path)) {
      const parsed = firstJsonObject(p.response) as { payload?: Record<string, unknown> } | null;
      if (parsed) {
        const payload = (parsed.payload ?? parsed) as Record<string, unknown>;
        const t = payload?.transactionDetails as Record<string, unknown> | undefined;
        const order = str(payload?.orderNumber);
        if (order) facts.orderNo ??= order;
        if (t) {
          facts.poBox = str(t.poBox) ?? facts.poBox;
          facts.emirate = str(t.emirateName) ?? facts.emirate;
          facts.branch = str(t.officeName) ?? facts.branch;
          facts.bundle = str(t.bundleDesc) ?? facts.bundle;
          facts.expiry = isoDay(t.boxExpiryDate) ?? facts.expiry;
        }
      }
    }
  }
  return facts;
}

/**
 * Read the transaction back out of the audit log.
 *
 * Scoped to the conversation, so this can only ever describe the transaction the
 * receipt is already being shown for.
 */
export async function receiptFacts(conversationId: string, agentId: string | null): Promise<ReceiptFacts> {
  try {
    const rows = await getDb()
      .select({ payload: auditLog.payload })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.conversationId, conversationId),
          ...(agentId ? [eq(auditLog.agentId, agentId)] : []),
          inArray(auditLog.action, ["integration_write", "integration_call_failed"])
        )
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(60);
    return factsFromRows(rows.map((r) => (r.payload ?? {}) as AuditedCall));
  } catch {
    /* a receipt is worth rendering with less on it, never worth failing */
    return {};
  }
}

/**
 * Should this reply carry the receipt link?
 *
 * The old rule was "this conversation has a paid payment", which is true of
 * every reply for the rest of the conversation — so a customer who paid for one
 * thing and moved on to another read "Download your receipt" under an answer
 * about issuing authorities, under a question about their trade licence, under
 * everything. Mid-way through a second application it reads as a payment they
 * have not made.
 *
 * So: on the turn the payment arrives, and whenever they ask. The application
 * panel carries a permanent link either way, which is where "I want it again"
 * is properly answered.
 */
export function shouldOfferReceipt(
  before: { status?: string; reference?: string | null } | null | undefined,
  after: { status?: string; reference?: string | null } | null | undefined,
  userMessage?: string | null
): boolean {
  if (after?.status !== "paid" || !after.reference) return false;
  const justArrived = before?.status !== "paid" || before.reference !== after.reference;
  return justArrived || /\b(receipt|invoice)\b|إيصال|فاتورة/i.test(userMessage ?? "");
}
