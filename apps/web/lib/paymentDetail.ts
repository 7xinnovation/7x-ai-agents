/**
 * One transaction, in full (6 November 2026).
 *
 * Emirates Post, on the dashboard's Payments page: "add more info about the
 * transaction other than the transcription — a page that has the PO Box number,
 * the transaction timeline and the transcription", and "allow me to export the
 * transaction details".
 *
 * Nothing new is recorded for this. The box is on the case, the timeline is the
 * audit trail the turn already writes (every call to Emirates Post, every
 * payment event), and the transcript is the conversation. This only reads them
 * together and says what each entry means in the words an operator uses.
 *
 * The pure parts (boxDetails, buildTimeline, the CSV) are exported apart from
 * the database read so they can be tested against real rows.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, agents, cases, payments } from "@dialog/db";
import { adminConversationDetail } from "./conversation";
import type { PaymentRow } from "./transactions";

export interface BoxDetails {
  journey: string | null;
  boxNumber: string | null;
  bundle: string | null;
  branch: string | null;
  emirate: string | null;
  duration: string | null;
  expiry: string | null;
  orderNumber: string | null;
  holdReference: string | null;
  customer: string | null;
  company: string | null;
  tradeLicence: string | null;
  email: string | null;
  phone: string | null;
  representative: string | null;
  keyDelivery: string | null;
  autoRenew: string | null;
  saveCard: string | null;
}

export interface TimelineEvent {
  at: Date;
  kind: "customer" | "payment" | "provider" | "error" | "system";
  title: string;
  detail?: string;
}

export interface AuditEntry {
  action: string;
  actor: string;
  payload: unknown;
  createdAt: Date;
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined || typeof v === "object") return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const EMIRATES: Record<string, string> = {
  DXB: "Dubai", AUH: "Abu Dhabi", SHJ: "Sharjah", AJM: "Ajman", UAQ: "Umm Al Quwain", RAK: "Ras Al Khaimah", FUJ: "Fujairah",
};

const JOURNEYS: Record<string, string> = {
  personal_po_box_rental: "Personal PO Box rental",
  corporate_po_box_rental: "Corporate PO Box rental",
  personal_po_box_renewal: "Personal PO Box renewal",
  corporate_po_box_renewal: "Corporate PO Box renewal",
  manage_po_box: "Manage a PO Box",
  new_license: "New postal licence",
  renewal: "Licence renewal",
};

export const journeyLabel = (key: string | null | undefined): string | null =>
  key ? JOURNEYS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : null;

/** "2_YEAR" → "2 years"; anything else as it was recorded. */
function durationLabel(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d+)[_ -]?(YEAR|MONTH)S?$/i.exec(s);
  if (!m) return s;
  const n = Number(m[1]);
  return `${n} ${m[2]!.toLowerCase()}${n === 1 ? "" : "s"}`;
}

const yesNo = (v: unknown): string | null => {
  if (v === true || v === "yes") return "Yes";
  if (v === false || v === "no") return "No";
  return str(v);
};

const dateOnly = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};

/**
 * One field of an audited response. The stored text is "HTTP 200 OK\n{json}"
 * followed by the notes the turn appended for the model, and is cut at 4,000
 * characters — so it is rarely parseable whole, and the fields are read by
 * name instead.
 */
function field(payload: Record<string, unknown>, name: string): string | null {
  const r = payload.response;
  if (typeof r !== "string") return null;
  const m = new RegExp(`"${name}"\\s*:\\s*("((?:[^"\\\\]|\\\\.)*)"|-?[0-9.]+)`).exec(r);
  if (!m) return null;
  return m[2] !== undefined ? m[2] : m[1]!;
}
const httpStatus = (payload: Record<string, unknown>): string | null => {
  const r = payload.response;
  if (typeof r !== "string") return null;
  const m = /HTTP (\d{3}[^\n]*)/.exec(r);
  return m ? m[1]!.trim() : null;
};
const timedOut = (payload: Record<string, unknown>) => typeof payload.response === "string" && payload.response.startsWith("TIMED OUT");
const bodyOf = (payload: Record<string, unknown>): Record<string, unknown> => {
  const input = payload.input as Record<string, unknown> | undefined;
  return (input?.body as Record<string, unknown> | undefined) ?? {};
};
const pathOf = (p: Record<string, unknown>) => str(p.path) ?? "";

/** What a PO Box transaction was for, from the case and the calls made for it. */
export function boxDetails(
  journeyKey: string | null | undefined,
  reference: string | null | undefined,
  data: Record<string, unknown>,
  audit: AuditEntry[]
): BoxDetails {
  const writes = audit.filter((a) => a.action === "integration_write").map((a) => (a.payload ?? {}) as Record<string, unknown>);
  // Newest first, whatever order they came in.
  const ordered = [...audit].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = (path: RegExp) =>
    ordered
      .filter((a) => a.action === "integration_write" || a.action === "rental_select_reused_hold")
      .map((a) => (a.payload ?? {}) as Record<string, unknown>)
      .find((p) => path.test(pathOf(p)));
  const select = latest(/Rental\/Select$/);
  const save = latest(/(Rental|Renewal)\/Save$/);

  // The bundle's name, when the catalogue call is on record ("IN:MyBox").
  const bundleCode = str(data.package) ?? str(data.bundle) ?? str(bodyOf(save ?? {}).newBundleId) ?? str(bodyOf(select ?? {}).bundleId);
  let bundle = bundleCode;
  if (bundleCode) {
    for (const a of audit) {
      const list = ((a.payload ?? {}) as Record<string, unknown>).bundles;
      if (!Array.isArray(list)) continue;
      const hit = list.map(String).find((b) => b.split(":")[0] === bundleCode);
      if (hit && hit.includes(":")) bundle = `${hit.split(":").slice(1).join(":")} (${bundleCode})`;
    }
  }

  const emirate = str(data.emirate);
  const first = str(data.subscriber_first_name);
  const last = str(data.subscriber_last_name);
  return {
    journey: journeyLabel(journeyKey),
    boxNumber: str(data.box_number) ?? str(data.po_box_number) ?? str(bodyOf(save ?? {}).boxNumber),
    bundle,
    branch: str(data.branch),
    emirate: emirate ? EMIRATES[emirate.toUpperCase()] ?? emirate : null,
    duration: durationLabel(data.duration) ?? durationLabel(data.renewal_period),
    expiry:
      dateOnly(data.new_expiry_date) ??
      dateOnly(bodyOf(save ?? {}).expiryDate) ??
      dateOnly(select ? field(select, "poBoxExpiryDate") : null) ??
      dateOnly(bodyOf(select ?? {}).poBoxExpiryDate),
    // EPGL keeps its LR number as the application id, not the case reference.
    orderNumber: str(reference) ?? (/^LR-/.test(String(data.application_id ?? "")) ? str(data.application_id) : null),
    // The newest reservation that carries its reference: a "reused" entry does not.
    holdReference:
      ordered
        .filter((a) => a.action === "integration_write")
        .map((a) => (a.payload ?? {}) as Record<string, unknown>)
        .filter((p) => /Rental\/Select$/.test(pathOf(p)))
        .map((p) => field(p, "subscriptionReferenceNumber"))
        .find(Boolean) ?? null,
    customer: str(data.contact_name) ?? str(data.full_name) ?? ([first, last].filter(Boolean).join(" ") || null),
    company: str(data.company_name),
    tradeLicence: str(data.trade_license_number),
    email: str(data.contact_email) ?? str(data.subscriber_email) ?? str(data.email),
    phone: str(data.contact_phone) ?? str(data.subscriber_mobile) ?? str(data.phone),
    representative: data.add_agent === "yes" || data.add_agent === true ? str(data.agent_full_name) ?? "Yes" : data.add_agent === "no" ? "None" : null,
    keyDelivery: str(data.key_delivery),
    autoRenew: yesNo(data.auto_renew_consent),
    saveCard: yesNo(data.save_card_consent),
  };
}

const money = (n: unknown) => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? `AED ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
};
const dubai = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" });
};

/** What each call to the system of record is, in an operator's words. */
const CALLS: { match: RegExp; name: string; done: string }[] = [
  { match: /Rental\/Select$/, name: "Box reservation", done: "Box reserved with Emirates Post" },
  { match: /Rental\/Save$/, name: "Rental order", done: "Rental order placed with Emirates Post" },
  { match: /Renewal\/Pricing$/, name: "Renewal pricing", done: "Renewal priced by Emirates Post" },
  { match: /Renewal\/Save$/, name: "Renewal order", done: "Renewal order placed with Emirates Post" },
  { match: /UpdatePayment/, name: "Payment update to Emirates Post", done: "Payment reported to Emirates Post" },
  { match: /ConfirmPayment$/, name: "Payment confirmation to Emirates Post", done: "Payment confirmed to Emirates Post" },
  { match: /CompositeHandler$/, name: "Application filing", done: "Application filed with EPGL" },
];
const callOf = (path: string) => CALLS.find((c) => c.match.test(path)) ?? { name: `System call ${path || ""}`.trim(), done: `System call: ${path || "unknown"}` };

function providerEvent(path: string, p: Record<string, unknown>): { title: string; detail?: string } {
  const b = bodyOf(p);
  const join = (bits: unknown[]) => bits.filter(Boolean).join(" · ") || undefined;
  if (/Rental\/Select$/.test(path)) {
    const ref = field(p, "subscriptionReferenceNumber");
    const amount = field(p, "minimumAmount");
    const until = field(p, "subcsriptionReferenceNumberExpiryDate");
    return {
      title: callOf(path).done,
      detail: join([ref && `reservation ${ref}`, amount && money(amount), until && `held until ${dubai(until)}`]),
    };
  }
  if (/(Rental|Renewal)\/Save$/.test(path))
    return {
      title: callOf(path).done,
      detail: join([str(b.boxNumber) && `box ${str(b.boxNumber)}`, b.totalAmount !== undefined && money(b.totalAmount), str(b.expiryDate) && `expires ${dateOnly(b.expiryDate)}`]),
    };
  return { title: callOf(path).done };
}

/** Why a call failed, in the provider's own codes. */
function failureDetail(path: string, p: Record<string, unknown>): string | undefined {
  if (timedOut(p)) return "timed out — the outcome is unknown";
  const code = field(p, "ERROR_CODE") ?? field(p, "RESPONSE_CODE");
  const msg = field(p, "ERROR_MESSAGE") ?? field(p, "RESPONSE_MESSAGE");
  return [httpStatus(p) && `HTTP ${httpStatus(p)}`, code && `error ${code}`, msg].filter(Boolean).join(" · ") || path || undefined;
}

/**
 * The transaction's story, oldest first: the conversation opening, each call to
 * the system of record, each payment event, the order, the confirmation. The
 * customer's own words are the transcript's, not repeated here.
 */
export function buildTimeline(input: {
  conversationStarted: Date | null;
  authenticatedAt?: unknown;
  audit: AuditEntry[];
  payment: Pick<PaymentRow, "reference" | "amount" | "currency" | "status" | "gatewayRef" | "createdAt" | "updatedAt">;
}): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  if (input.conversationStarted) out.push({ at: input.conversationStarted, kind: "customer", title: "Conversation started" });
  const signedIn = str(input.authenticatedAt);
  if (signedIn && !Number.isNaN(new Date(signedIn).getTime())) out.push({ at: new Date(signedIn), kind: "customer", title: "Signed in" });

  let raised = false;
  let settled = false;
  let declined = false;
  for (const a of input.audit) {
    const p = (a.payload ?? {}) as Record<string, unknown>;
    const path = pathOf(p);
    switch (a.action) {
      case "integration_write": {
        const e = providerEvent(path, p);
        out.push({ at: a.createdAt, kind: "provider", ...e });
        break;
      }
      case "rental_select_reused_hold":
        out.push({ at: a.createdAt, kind: "provider", title: "Existing box reservation reused" });
        break;
      case "integration_call_failed":
        out.push({
          at: a.createdAt,
          kind: "error",
          title: timedOut(p) ? `${callOf(path).name} timed out` : `${callOf(path).name} failed`,
          detail: failureDetail(path, p),
        });
        break;
      case "payment_initiated":
        raised = true;
        out.push({ at: a.createdAt, kind: "payment", title: "Payment raised", detail: money(p.amount) ?? undefined });
        break;
      case "payment_confirmed":
      case "payment_paid_via_gateway_probe":
      case "payment_paid_on_return":
        settled = true;
        out.push({
          at: a.createdAt,
          kind: "payment",
          title: "Payment settled",
          detail: a.action === "payment_paid_via_gateway_probe" ? "confirmed by asking the gateway" : a.action === "payment_paid_on_return" ? "confirmed when the customer returned" : undefined,
        });
        break;
      case "payment_failed_via_gateway_probe":
        declined = true;
        out.push({ at: a.createdAt, kind: "error", title: "Payment declined by the gateway" });
        break;
      case "case_submitted":
        out.push({ at: a.createdAt, kind: "system", title: "Order submitted", detail: str(p.reference) ? `reference ${str(p.reference)}` : undefined });
        break;
      case "confirmation_email_sent":
      case "email_sent":
        out.push({ at: a.createdAt, kind: "system", title: "Confirmation email sent", detail: str(p.to) ?? undefined });
        break;
      case "email_send_failed":
        out.push({ at: a.createdAt, kind: "error", title: "Confirmation email failed" });
        break;
      case "escalation_created":
        out.push({ at: a.createdAt, kind: "system", title: "Callback requested", detail: str(p.reference) ? `case ${str(p.reference)}` : undefined });
        break;
      case "consent_declined":
        out.push({ at: a.createdAt, kind: "customer", title: "Customer declined a consent" });
        break;
      case "session_expired":
        out.push({ at: a.createdAt, kind: "system", title: "Session expired" });
        break;
      case "survey_offered":
        out.push({ at: a.createdAt, kind: "system", title: "Satisfaction survey offered" });
        break;
    }
  }

  /**
   * The payment row is the record of the money, and a saved-card charge or a
   * payment settled before this audit existed leaves no event of its own — so
   * what the row says is shown when nothing above has said it.
   */
  const pay = input.payment;
  const ref = pay.gatewayRef ? `gateway reference ${pay.gatewayRef}` : null;
  // Raised and settled in the same moment is one event: a saved card charged
  // with the order, with no card page in between.
  const atOnce = pay.status === "paid" && !raised && !settled && Math.abs(pay.updatedAt.getTime() - pay.createdAt.getTime()) < 5000;
  if (atOnce) out.push({ at: pay.createdAt, kind: "payment", title: "Payment settled", detail: [money(pay.amount), ref].filter(Boolean).join(" · ") });
  else {
    if (!raised) out.push({ at: pay.createdAt, kind: "payment", title: "Payment raised", detail: money(pay.amount) ?? undefined });
    if (pay.status === "paid" && !settled) out.push({ at: pay.updatedAt, kind: "payment", title: "Payment settled", detail: ref ?? undefined });
  }
  if (pay.status === "failed" && !declined) out.push({ at: pay.updatedAt, kind: "error", title: "Payment declined" });

  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface PaymentDetail {
  payment: PaymentRow;
  journeyKey: string | null;
  caseReference: string | null;
  box: BoxDetails;
  timeline: TimelineEvent[];
  messages: { role: string; content: string; createdAt: Date }[];
}

/** One payment with everything around it, or null when it is not there or not the caller's to see. */
export async function paymentDetail(id: string): Promise<PaymentDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const [row] = await db
    .select({
      id: payments.id,
      conversationId: payments.conversationId,
      reference: payments.reference,
      amount: payments.amount,
      currency: payments.currency,
      status: payments.status,
      provider: payments.provider,
      gatewayRef: payments.gatewayRef,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
      agentName: agents.name,
      agentSlug: agents.slug,
    })
    .from(payments)
    .leftJoin(agents, eq(payments.agentId, agents.id))
    .where(eq(payments.id, id))
    .limit(1);
  if (!row) return null;
  const payment: PaymentRow = { ...row, agentName: row.agentName ?? null, agentSlug: row.agentSlug ?? null, provider: row.provider ?? null, gatewayRef: row.gatewayRef ?? null };
  // The scope check lives in adminConversationDetail; a payment with no
  // conversation is only shown to an unscoped account.
  const conv = payment.conversationId ? await adminConversationDetail(payment.conversationId) : null;
  if (payment.conversationId && !conv) return null;
  if (!payment.conversationId) {
    const { currentScope } = await import("./scope");
    if (await currentScope()) return null;
  }
  const state = (conv?.case ?? null) as { journeyKey?: string | null; reference?: string | null; data?: Record<string, unknown> } | null;
  const data = state?.data ?? {};
  const audit: AuditEntry[] = (conv?.audit ?? []).map((a) => ({ action: a.action, actor: a.actor, payload: a.payload, createdAt: new Date(a.createdAt) }));
  return {
    payment,
    journeyKey: state?.journeyKey ?? null,
    caseReference: state?.reference ?? null,
    box: boxDetails(state?.journeyKey, state?.reference, data, audit),
    timeline: buildTimeline({ conversationStarted: conv ? new Date(conv.createdAt) : null, authenticatedAt: data.__authenticated_at, audit, payment }),
    messages: (conv?.messages ?? []).map((m) => ({ role: m.role, content: m.content, createdAt: new Date(m.createdAt) })),
  };
}

/** The case behind each payment on a page, in one read — for the list export. */
export async function casesForConversations(ids: string[]): Promise<Map<string, { journeyKey: string | null; reference: string | null; data: Record<string, unknown> }>> {
  const out = new Map<string, { journeyKey: string | null; reference: string | null; data: Record<string, unknown> }>();
  if (!ids.length) return out;
  const rows = await getDb().select({ conversationId: cases.conversationId, state: cases.state }).from(cases).where(inArray(cases.conversationId, ids));
  for (const r of rows) {
    const s = r.state as { journeyKey?: string | null; reference?: string | null; data?: Record<string, unknown> };
    out.set(r.conversationId, { journeyKey: s.journeyKey ?? null, reference: s.reference ?? null, data: s.data ?? {} });
  }
  return out;
}

// ---- export -----------------------------------------------------------------

/** One CSV cell, quoted the way a spreadsheet expects it. */
export const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? dubaiFull(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const dubaiFull = (d: Date) =>
  d.toLocaleString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Dubai" });
const STATUS: Record<string, string> = { paid: "Settled", failed: "Declined", initiated: "Open" };
export const statusLabel = (s: string) => STATUS[s] ?? s;

/** The BOM is for Excel, which otherwise reads Arabic names as mojibake. */
export const csv = (rows: unknown[][]) => `﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}`;

export const LIST_HEAD = [
  "Raised (Dubai time)", "Last updated (Dubai time)", "Agent", "Journey", "Status", "Amount", "Currency",
  "Payment reference", "Gateway", "Gateway reference", "Order / application reference",
  "PO Box number", "Bundle", "Branch", "Emirate", "Duration", "Box expiry",
  "Customer", "Company", "Trade licence", "Email", "Phone", "Conversation id",
];

export function listRow(p: PaymentRow, c: { journeyKey: string | null; reference: string | null; data: Record<string, unknown> } | undefined): unknown[] {
  const b = boxDetails(c?.journeyKey, c?.reference, c?.data ?? {}, []);
  return [
    p.createdAt, p.updatedAt, p.agentName, b.journey, statusLabel(p.status), p.amount.toFixed(2), p.currency,
    p.reference, p.provider ?? "default", p.gatewayRef, b.orderNumber,
    b.boxNumber, b.bundle, b.branch, b.emirate, b.duration, b.expiry,
    b.customer, b.company, b.tradeLicence, b.email, b.phone, p.conversationId,
  ];
}

/** One transaction as a spreadsheet: its details, its timeline, its transcript. */
export function detailCsv(d: PaymentDetail): string {
  const b = d.box;
  const p = d.payment;
  const kv: [string, unknown][] = [
    ["Status", statusLabel(p.status)],
    ["Amount", `${p.currency} ${p.amount.toFixed(2)}`],
    ["Raised (Dubai time)", p.createdAt],
    ["Last updated (Dubai time)", p.updatedAt],
    ["Agent", p.agentName],
    ["Journey", b.journey],
    ["Payment reference", p.reference],
    ["Gateway", p.provider ?? "default"],
    ["Gateway reference", p.gatewayRef],
    ["Order / application reference", b.orderNumber],
    ["Box reservation reference", b.holdReference],
    ["PO Box number", b.boxNumber],
    ["Bundle", b.bundle],
    ["Branch", b.branch],
    ["Emirate", b.emirate],
    ["Duration", b.duration],
    ["Box expiry", b.expiry],
    ["Customer", b.customer],
    ["Company", b.company],
    ["Trade licence", b.tradeLicence],
    ["Email", b.email],
    ["Phone", b.phone],
    ["Representative", b.representative],
    ["Key delivery", b.keyDelivery],
    ["Auto-renew consent", b.autoRenew],
    ["Save card consent", b.saveCard],
    ["Conversation id", p.conversationId],
  ];
  return csv([
    ["Transaction", ""],
    ...kv.filter(([, v]) => v !== null && v !== undefined && v !== ""),
    [],
    ["Timeline (Dubai time)", "Event", "Detail"],
    ...d.timeline.map((e) => [e.at, e.title, e.detail ?? ""]),
    [],
    ["Transcript (Dubai time)", "Speaker", "Message"],
    ...d.messages.map((m) => [m.createdAt, m.role === "user" ? "Customer" : "Agent", m.content]),
  ]);
}
