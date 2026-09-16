import { getDb, cases, conversations, messages, auditLog, agents } from "@dialog/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { CaseState } from "@dialog/config";

/**
 * Every request that reached the end, as the admin panel shows it.
 *
 * Asked for on 16 September: a tab per agent listing the confirmed summaries of
 * completed requests "to keep track of the requests that also come in through
 * here alongside how we send it to Salesforce". Both halves matter — Emirates
 * Post and EPGL each have their own system of record, and the question their
 * teams actually ask is not "what did the customer see" or "what did we send"
 * but whether those two agree.
 *
 * Nothing new is written for this. Everything it shows was already recorded when
 * it happened: the case is the transaction, the audit log is the outbound call
 * with its response, and the assistant's own confirmation message is the summary
 * the customer read. So it works backwards over every request already made, not
 * only the ones that come in after it shipped — which is the point of a record.
 */

/** Completed means the system of record has it, or the money arrived. */
const COMPLETED = sql`(
  ${cases.state}->>'reference' IS NOT NULL
  OR ${cases.state}->>'status' = 'submitted'
  OR ${cases.state}->'payment'->>'status' = 'paid'
)`;

export interface RequestRow {
  caseId: string;
  conversationId: string;
  /** What the customer quotes: EPGL's LR-37380 rather than the record id. */
  reference: string | null;
  /** The system of record's own id, when it differs from the above. */
  recordId: string | null;
  journey: string | null;
  /** Who or what the request is about — a company, or a PO Box. */
  subject: string | null;
  customer: string | null;
  email: string | null;
  phone: string | null;
  amount: number | null;
  currency: string;
  paymentStatus: string;
  documents: { total: number; attached: number };
  /** Whether the outbound write to the system of record succeeded. */
  sentToRecord: "ok" | "failed" | "none";
  locale: string;
  authenticated: boolean;
  completedAt: string;
}

const str = (v: unknown): string | null => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s : null;
};

/** A case's headline: the company for a licence, the box for a rental. */
function subjectOf(state: CaseState): string | null {
  const d = state.data as Record<string, unknown>;
  return (
    str(d.company_name) ??
    str(d.company_name_en) ??
    (str(d.box_number) ? `PO Box ${str(d.box_number)}` : null) ??
    str(d.po_box_number) ??
    str(d.trade_license_number)
  );
}

/** snake_case_key → "Snake case key", for a field nobody wrote a label for. */
export function labelFor(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Values the customer never typed and nobody needs to read back. */
const INTERNAL_KEY = /^__/;

export interface SummaryCard {
  title: string | null;
  rows: { label: string; value: string }[];
  total: string | null;
}

export interface RequestDetail extends RequestRow {
  /** The confirmation card the customer was shown, exactly as it was written. */
  confirmation: SummaryCard | null;
  /**
   * Whether that card is the CONFIRMATION or merely the last one shown.
   *
   * A conversation does not stop at the confirmation. A renewal confirmed as
   * "Renewal Confirmed — Reference PER-9016" was followed by the customer asking
   * where the branch is, and the last summary card in that transcript is the
   * branch's opening hours. Showing that under the heading "Confirmed summary"
   * would be the panel making something up, so the panel is told which it has.
   */
  confirmationKind: "confirmation" | "latest";
  /** The closing message in full, minus its chat controls. */
  confirmationText: string | null;
  /** Everything the case collected. */
  fields: { key: string; label: string; value: string }[];
  docs: { key: string; label: string; status: string; fileName: string | null; rejectionReason: string | null }[];
  /** What we sent the system of record, and what it said back. */
  calls: {
    at: string;
    action: string;
    tool: string | null;
    method: string | null;
    path: string | null;
    request: unknown;
    response: string | null;
    ok: boolean;
  }[];
  /** The confirmation email, if one went out. */
  emails: { at: string; action: string; to: string | null; subject: string | null; reason: string | null }[];
  /**
   * The conversation that produced all of it.
   *
   * Asked for on 16 September: opening a request should show "a nice pop-up of
   * the conversations it's related to". The summary answers what was agreed and
   * the calls answer what we sent; when those two disagree the answer is always
   * in what was actually said, and having to leave the tab to read it is how a
   * reconciliation stops halfway.
   */
  messages: { role: "user" | "assistant"; content: string; at: string }[];
}

/** Audit rows that record an outbound write, in the order they happened. */
const CALL_ACTIONS = [
  "integration_write",
  "integration_call_failed",
  "sf_document_attached",
  "sf_document_failed",
  "sf_document_skipped",
  "case_submitted",
];
const EMAIL_ACTIONS = [
  "confirmation_email_sent",
  "confirmation_email_failed",
  "confirmation_email_skipped",
  "email_sent",
  "email_send_failed",
];

/**
 * The ```summary card out of an assistant message.
 *
 * Same shape the widget renders it in (see Markdown.tsx): a `title:` line,
 * `- Label: Value` rows and an optional `total:` footer.
 */
export function parseSummaryCard(text: string): SummaryCard | null {
  const m = /```[ \t]*summary[ \t]*\n([\s\S]*?)\n[ \t]*```/i.exec(text);
  if (!m) return null;
  const rows: { label: string; value: string }[] = [];
  let title: string | null = null;
  let total: string | null = null;
  for (const line of (m[1] ?? "").split("\n")) {
    const meta = line.match(/^\s*(title|total)\s*:\s*(.+?)\s*$/i);
    const row = line.match(/^\s*-\s+(.+?)\s*:\s*(.+?)\s*$/);
    if (meta && /^title$/i.test(meta[1] ?? "")) title = (meta[2] ?? "").trim();
    else if (meta) total = (meta[2] ?? "").trim();
    else if (row) rows.push({ label: (row[1] ?? "").trim(), value: (row[2] ?? "").trim() });
  }
  return rows.length || total || title ? { title, rows, total } : null;
}

/**
 * Is this card confirming the transaction, or just a card?
 *
 * It names the reference the case ended up with, or it says so in words. Both
 * are checked because the two agents write it differently: EPGL titles the card
 * "APPLICATION CONFIRMED — <company>" and Emirates Post writes "Renewal
 * Confirmed" with a "- Reference:" row under it.
 */
export function isConfirmationCard(card: SummaryCard, reference: string | null): boolean {
  const title = card.title ?? "";
  if (/confirm|submitted|complete|receipt|مؤكد|تم الإرسال|تم التأكيد/i.test(title)) return true;
  for (const row of card.rows) {
    if (/reference|مرجع/i.test(row.label)) return true;
    if (reference && row.value.includes(reference)) return true;
    if (/\bpaid\b|مدفوع/i.test(row.value)) return true;
  }
  return false;
}

/** A reply with its chat controls taken out, for reading in a list. */
export function withoutControls(text: string): string {
  return text
    .replace(/```[ \t]*(cards|upload|buttons|toggles|map|locate|pay|select|summary)[ \t]*\n[\s\S]*?\n[ \t]*```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rowFromCase(
  row: { caseId: string; conversationId: string; state: CaseState; updatedAt: Date | string; locale: string; authenticated: boolean },
  writes: Map<string, "ok" | "failed">
): RequestRow {
  const state = row.state;
  const docs = state.documents ?? [];
  return {
    caseId: row.caseId,
    conversationId: row.conversationId,
    reference: str(state.referenceLabel) ?? str(state.reference),
    recordId: state.referenceLabel ? str(state.reference) : null,
    journey: str(state.journeyKey),
    subject: subjectOf(state),
    customer: str((state.data as Record<string, unknown>).contact_name),
    email: str((state.data as Record<string, unknown>).contact_email),
    phone: str((state.data as Record<string, unknown>).contact_phone),
    amount: typeof state.payment?.amount === "number" ? state.payment.amount : null,
    currency: state.payment?.currency ?? "AED",
    paymentStatus: state.payment?.status ?? "none",
    documents: {
      total: docs.length,
      attached: docs.filter((d) => d.status === "uploaded" || d.status === "accepted").length,
    },
    sentToRecord: writes.get(row.conversationId) ?? "none",
    locale: row.locale,
    authenticated: row.authenticated,
    completedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** The completed requests for one agent, newest first. */
export async function completedRequests(agentId: string, limit = 200): Promise<RequestRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      caseId: cases.id,
      conversationId: cases.conversationId,
      state: cases.state,
      updatedAt: cases.updatedAt,
      locale: conversations.locale,
      authenticated: conversations.authenticated,
    })
    .from(cases)
    .innerJoin(conversations, eq(conversations.id, cases.conversationId))
    .where(and(eq(cases.agentId, agentId), COMPLETED))
    .orderBy(desc(cases.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  if (!rows.length) return [];

  // Did the write to the system of record land? One query for the whole page,
  // rather than one per row: a failed submission is the thing this list exists
  // to make visible, so it cannot be left to a detail view nobody opens.
  const writes = new Map<string, "ok" | "failed">();
  const ids = rows.map((r) => r.conversationId);
  const audits = await db
    .select({ conversationId: auditLog.conversationId, action: auditLog.action })
    .from(auditLog)
    .where(
      and(
        inArray(auditLog.conversationId, ids),
        inArray(auditLog.action, ["integration_write", "integration_call_failed"])
      )
    );
  for (const a of audits) {
    if (!a.conversationId) continue;
    // One success is enough; a failure only shows when nothing succeeded.
    if (a.action === "integration_write") writes.set(a.conversationId, "ok");
    else if (!writes.has(a.conversationId)) writes.set(a.conversationId, "failed");
  }
  return rows.map((r) => rowFromCase(r as never, writes));
}

/** One request, with the confirmation the customer read and the calls we made. */
export async function requestDetail(agentId: string, caseId: string): Promise<RequestDetail | null> {
  const db = getDb();
  const [row] = await db
    .select({
      caseId: cases.id,
      conversationId: cases.conversationId,
      state: cases.state,
      updatedAt: cases.updatedAt,
      locale: conversations.locale,
      authenticated: conversations.authenticated,
    })
    .from(cases)
    .innerJoin(conversations, eq(conversations.id, cases.conversationId))
    .where(and(eq(cases.id, caseId), eq(cases.agentId, agentId)))
    .limit(1);
  if (!row) return null;
  const state = row.state as CaseState;

  const auditRows = await db
    .select({ action: auditLog.action, payload: auditLog.payload, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(and(eq(auditLog.conversationId, row.conversationId), inArray(auditLog.action, [...CALL_ACTIONS, ...EMAIL_ACTIONS])))
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  const writes = new Map<string, "ok" | "failed">();
  for (const a of auditRows) {
    if (a.action === "integration_write") writes.set(row.conversationId, "ok");
    else if (a.action === "integration_call_failed" && !writes.has(row.conversationId)) writes.set(row.conversationId, "failed");
  }

  // The confirmation the customer was shown: the LAST assistant message carrying
  // a summary card. Later beats earlier — a licence application confirms once,
  // but a conversation that corrected something confirms twice and the second
  // one is the truth.
  // The whole conversation, oldest first, for the panel — and its assistant
  // messages, newest first, for the card hunt below.
  const transcript = await db
    .select({ role: messages.role, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, row.conversationId), inArray(messages.role, ["user", "assistant"])))
    .orderBy(asc(messages.createdAt))
    .limit(400);
  const assistant = transcript.filter((m) => m.role === "assistant").reverse();
  let confirmation: SummaryCard | null = null;
  let confirmationText: string | null = null;
  let confirmationKind: RequestDetail["confirmationKind"] = "latest";
  let latest: { card: SummaryCard; text: string } | null = null;
  const customerRef = str(state.referenceLabel) ?? str(state.reference);
  for (const m of assistant) {
    const card = parseSummaryCard(m.content);
    if (!card) continue;
    latest ??= { card, text: withoutControls(m.content) };
    // A card whose own rows say nothing conclusive, in a message that quotes the
    // reference the case ended up with, IS the confirmation: that number does not
    // exist until the system of record issues it, so no earlier message can
    // contain it. EPGL's viban branch closes exactly like this — a card headed
    // "Application summary" under a line naming LR-37377.
    const namesReference = Boolean(customerRef && m.content.includes(customerRef));
    if (!namesReference && !isConfirmationCard(card, customerRef)) continue;
    confirmation = card;
    confirmationText = withoutControls(m.content) || null;
    confirmationKind = "confirmation";
    break;
  }
  if (!confirmation && latest) {
    confirmation = latest.card;
    confirmationText = latest.text || null;
  }
  // THE CLOSING MESSAGE IS THE ONE THAT FIRST SAID THE REFERENCE.
  //
  // Not every journey confirms with a card. LR-37377 — a Virtual IBAN licence —
  // closed with "Your application has been submitted successfully. Here are your
  // details:" and set them out in bold rather than in a summary block, so the
  // best card in that transcript is the pre-submission one and the message worth
  // reading is not the message that card came from. Oldest first, because the
  // reference is first spoken at the moment it is issued.
  if (customerRef && confirmationKind !== "confirmation") {
    const naming = [...assistant].reverse().find((m) => m.content.includes(customerRef));
    if (naming) confirmationText = withoutControls(naming.content) || confirmationText;
  }

  const data = state.data as Record<string, unknown>;
  const fields = Object.keys(data)
    .filter((k) => !INTERNAL_KEY.test(k))
    .sort()
    .map((k) => {
      const v = data[k];
      const value = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return { key: k, label: labelFor(k), value };
    })
    .filter((f) => f.value !== "");

  const isEmail = (a: string) => EMAIL_ACTIONS.includes(a);
  return {
    ...rowFromCase(row as never, writes),
    confirmation,
    confirmationKind,
    confirmationText,
    fields,
    docs: (state.documents ?? []).map((d) => ({
      key: d.key,
      label: labelFor(d.key),
      status: d.status,
      fileName: d.fileName ?? null,
      rejectionReason: d.rejectionReason ?? null,
    })),
    calls: auditRows
      .filter((a) => !isEmail(a.action))
      .map((a) => {
        const p = (a.payload ?? {}) as Record<string, unknown>;
        return {
          at: new Date(a.createdAt).toISOString(),
          action: a.action,
          tool: str(p.tool),
          method: str(p.method),
          path: str(p.path) ?? str(p.label),
          request: p.input ?? (a.action === "case_submitted" ? { reference: p.reference, journey: p.journey } : null),
          response: str(p.response) ?? str(p.error),
          ok: !/failed/.test(a.action),
        };
      }),
    messages: transcript.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      at: new Date(m.createdAt).toISOString(),
    })),
    emails: auditRows
      .filter((a) => isEmail(a.action))
      .map((a) => {
        const p = (a.payload ?? {}) as Record<string, unknown>;
        return {
          at: new Date(a.createdAt).toISOString(),
          action: a.action,
          to: str(p.to),
          subject: str(p.subject),
          reason: str(p.reason),
        };
      }),
  };
}

/** The agent's own name, for the export header. */
export async function agentName(agentId: string): Promise<string | null> {
  const db = getDb();
  const [a] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId)).limit(1);
  return a?.name ?? null;
}
