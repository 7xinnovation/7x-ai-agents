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
      try {
        const parsed = JSON.parse(p.response.slice(p.response.indexOf("{")));
        const payload = parsed?.payload ?? parsed;
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
      } catch {
        /* an unreadable confirmation leaves the request's own figures standing */
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
