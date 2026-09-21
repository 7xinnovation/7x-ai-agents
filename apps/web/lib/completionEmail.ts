import { isValidEmail } from "./email";
import { POSTAL_ACTIVITIES } from "./epglFields";

/**
 * The confirmation email, sent because the journey finished — not because the
 * model remembered to send one.
 *
 * Reported 16 September: "is the email configured to share the summary because I
 * only see it sending the email to me sometimes, not every single time." It is
 * configured, and that was the whole of the problem: the only way an email ever
 * went out was the send_confirmation_email tool, which the assistant calls at its
 * own discretion. Emirates Post's guidance tells it to OFFER the email at
 * completion; EPGL's says nothing about email at all. So "sometimes" is exactly
 * what the design produced.
 *
 * A completed transaction is not a judgement call, so this does not ask. It fires
 * from the same moment the survey does — the money settled and the application in
 * the system of record — once per case.
 *
 * WHAT IT SAYS is the assistant's own confirmation message, rendered as plain
 * text. Writing a second summary here would mean maintaining a parallel copy of
 * every journey's completion wording and its SLA, and the two would drift; the
 * customer would then hold an email that says something the chat did not. The
 * card, the bullets and the reference in the email are the ones they just read.
 */

/** Fenced blocks that are chat controls: they have no meaning in an email. */
const CONTROL_FENCE = /^[ \t]*```[ \t]*(cards|upload|buttons|toggles|map|locate|pay|select)[ \t]*$/i;
const SUMMARY_FENCE = /^[ \t]*```[ \t]*summary[ \t]*$/i;
const ANY_FENCE = /^[ \t]*```/;

/** `[label](href)` → label plus a usable address; relative hrefs are absolutised. */
function links(line: string, baseUrl?: string | null): string {
  return line.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const abs = href.startsWith("/") && baseUrl ? `${baseUrl.replace(/\/$/, "")}${href}` : href;
    return `${label}: ${abs}`;
  });
}

function inlineText(line: string, baseUrl?: string | null): string {
  return links(line, baseUrl)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/**
 * The reply the customer just read, as plain text.
 *
 * Summary cards become labelled lines — they carry the reference, the amount and
 * what was submitted, which is the part of the message worth keeping. Every other
 * fenced block is a control (a button, an upload slot, a payment widget) and is
 * dropped: an email cannot honour a tap.
 */
export function plainFromReply(text: string, baseUrl?: string | null): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!ANY_FENCE.test(line)) {
      out.push(inlineText(line, baseUrl));
      continue;
    }
    const isSummary = SUMMARY_FENCE.test(line);
    const body: string[] = [];
    i++;
    while (i < lines.length && !ANY_FENCE.test(lines[i] ?? "")) { body.push(lines[i] ?? ""); i++; }
    // i now sits on the closing fence (or past the end for an unclosed one).
    if (!isSummary) {
      // A control block is dropped — an email cannot honour a tap. Anything
      // else fenced is ordinary text and is kept.
      if (!CONTROL_FENCE.test(line)) out.push(...body.map((b) => inlineText(b, baseUrl)));
      continue;
    }
    for (const b of body) {
      const meta = b.match(/^\s*(title|total)\s*:\s*(.+?)\s*$/i);
      const row = b.match(/^\s*-\s+(.+?)\s*:\s*(.+?)\s*$/);
      // The title is left as a block of its own: textToHtml reads a RUN of
      // "label: value" lines as a detail table, and one line without a colon at
      // the top of the run turns the whole card back into a paragraph.
      if (meta && /^title$/i.test(meta[1] ?? "")) out.push("", inlineText(meta[2] ?? "", baseUrl), "");
      else if (meta) out.push(inlineText(`Total: ${meta[2] ?? ""}`.replace(/^Total: Total:/i, "Total:"), baseUrl));
      else if (row) {
        // A row whose whole value is a link already has a label of its own —
        // "Receipt: Download receipt: https://…" says it twice.
        const only = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(row[2] ?? "");
        const value = only ? links(`[ ](${only[2]})`, baseUrl).trim().replace(/^:\s*/, "") : inlineText(row[2] ?? "", baseUrl);
        out.push(`  ${row[1]}: ${value}`);
      }
      else if (b.trim()) out.push(inlineText(b, baseUrl));
    }
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * WHAT THE EMAIL SAYS, AND WHAT IT DOES NOT.
 *
 * The first version sent the assistant's closing message as the body, on the
 * reasoning that a second summary written here would drift from the journey's
 * own wording. What arrived read as a transcript — "On it — submitting your
 * application now.", "Here are your details:", "Keep LR-37382 handy" — three
 * lines of conversation for every line of fact. Reported 16 September: "should
 * not show a transcript on the email, it should show the summary".
 *
 * So the body is a SUMMARY, built in this order:
 *
 *   1. the confirmation card the customer was shown, when the reply carried one
 *      — those rows are the summary, already agreed with the journey;
 *   2. otherwise the case itself: what was applied for, for whom, with how many
 *      documents, and what was paid.
 *
 * The only prose kept from the reply is the "what happens next" list, because
 * it carries the review SLA and the payment route, both of which are the
 * journey's to state and neither of which should be re-written here.
 */

/** Case fields worth putting in a confirmation, in the order they read best. */
const SUMMARY_FIELDS: { key: string; en: string; ar: string }[] = [
  { key: "company_name", en: "Company", ar: "الشركة" },
  { key: "trade_license_number", en: "Trade licence", ar: "رقم الرخصة التجارية" },
  { key: "legal_form", en: "Legal form", ar: "الشكل القانوني" },
  { key: "box_number", en: "PO Box", ar: "صندوق البريد" },
  { key: "po_box", en: "PO Box", ar: "صندوق البريد" },
  { key: "branch", en: "Branch", ar: "الفرع" },
  { key: "package", en: "Package", ar: "الباقة" },
  { key: "rental_duration", en: "Duration", ar: "المدة" },
  { key: "emirate", en: "Emirate", ar: "الإمارة" },
  { key: "region", en: "Region", ar: "المنطقة" },
];

const PAY_METHOD: Record<string, { en: string; ar: string }> = {
  viban: { en: "Bank transfer (Virtual IBAN)", ar: "تحويل بنكي (آيبان افتراضي)" },
  card: { en: "Card payment", ar: "الدفع بالبطاقة" },
};

/** "card" as the customer would read it, in their language. */
export function payMethodLabel(method: string | null | undefined, locale?: string): string {
  const key = String(method ?? "").trim().toLowerCase();
  if (!key) return "";
  const known = PAY_METHOD[key];
  return known ? (locale === "ar" ? known.ar : known.en) : String(method).trim();
}

/** An amount the way each language writes one: "AED 1,000.00" / "1,000.00 درهم". */
const money = (amount: number | null | undefined, currency: string | null | undefined, locale?: string) => {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return "";
  const n = amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ccy = currency || "AED";
  return locale === "ar" ? `${n} ${ccy === "AED" ? "درهم" : ccy}` : `${ccy} ${n}`;
};

/** A bare date in either spelling, as DAY-MONTH-YEAR. Empty for anything else. */
export function normaliseDate(value: string): string {
  const v = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  return /^\d{2}-\d{2}-\d{4}$/.test(v) ? v : "";
}

/** 16-09-2026 — the format the journeys show dates in, in both languages. */
export function emailDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export interface CaseFacts {
  data: Record<string, unknown>;
  documents: { status: string }[];
  payment: { status?: string; amount?: number | null; currency?: string | null };
}

/**
 * The summary rows for a case that confirmed without a card.
 *
 * EPGL's Virtual IBAN branch is the one that matters here: it submits, states
 * the IBAN is coming, and never draws a summary card — so an email built only
 * from cards would have nothing to show on the branch where the customer has
 * the longest wait and the most reason to re-read what they sent.
 */
export function summaryRows(facts: CaseFacts, locale?: string): { label: string; value: string }[] {
  const ar = locale === "ar";
  const rows: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const f of SUMMARY_FIELDS) {
    const label = ar ? f.ar : f.en;
    if (seen.has(label)) continue;
    const v = String(facts.data[f.key] ?? "").trim();
    if (!v) continue;
    seen.add(label);
    rows.push({ label, value: v });
  }
  const activities = POSTAL_ACTIVITIES.filter((p) =>
    String(facts.data.activity_codes ?? "").includes(p.code)
  ).map((p) => p.en);
  if (activities.length) rows.push({ label: ar ? "الأنشطة البريدية" : "Postal activities", value: activities.join(", ") });

  const attached = facts.documents.filter((d) => d.status === "uploaded" || d.status === "accepted").length;
  if (attached) rows.push({ label: ar ? "المستندات" : "Documents", value: ar ? `${attached} مرفقة` : `${attached} submitted` });

  // What was paid, or how it is going to be. An unpaid Virtual IBAN application
  // must not read as though money has changed hands.
  const method = PAY_METHOD[String(facts.data.payment_method ?? "").toLowerCase()];
  const amount = money(facts.payment.amount, facts.payment.currency, locale);
  const paid = facts.payment.status === "paid";
  const payValue = paid
    ? `${amount || (ar ? "مدفوع" : "paid")}${amount ? (ar ? " — مدفوع" : " — paid") : ""}`
    : method
      ? `${ar ? method.ar : method.en}${amount ? ` — ${amount}` : ""}`
      : amount;
  if (payValue) rows.push({ label: ar ? "الدفع" : "Payment", value: payValue });
  return rows;
}

/**
 * The "what happens next" list out of the reply, if it wrote one.
 *
 * Kept rather than rewritten: it states the review SLA and, on the Virtual IBAN
 * branch, who issues the IBAN and when. Both belong to the journey, and a copy
 * maintained here would be the copy that goes stale.
 */
export function nextSteps(reply: string): string[] {
  const clean = plainFromReply(reply);
  // The Arabic heading is the model's own wording and it varies: "ما الذي سيحدث
  // بعد ذلك", "ماذا يحدث الآن", "الخطوات التالية". All of them, and the future
  // tense that LR-37385 used, which the first pattern missed.
  const at = clean.search(/^[^\n]*(what happens next|here'?s what happens|الخطوات التالية|ما(?:ذا)? ?(?:الذي )?س?يحدث)[^\n]*$/im);
  if (at === -1) return [];
  const after = clean.slice(at).split("\n").slice(1);
  const out: string[] = [];
  for (const line of after) {
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
    if (bullet) { out.push(bullet[1]!); continue; }
    if (!line.trim()) { if (out.length) break; continue; }
    break;
  }
  return out.slice(0, 6);
}

const STR = {
  en: {
    subject: (name: string, ref: string) => `${name} — confirmation (${ref})`,
    greeting: (who: string) => (who ? `Dear ${who},` : "Hello,"),
    submitted: "Your application has been submitted.",
    confirmed: "Your application is confirmed and your payment has been received.",
    reference: "Reference",
    date: "Date",
    next: "What happens next:",
    receipt: "Download your receipt",
    receiptHead: "Your receipt",
    receiptNo: "Receipt no.",
    amountPaid: "Amount paid",
    method: "Payment method",
    vibanHead: "Paying by bank transfer",
    viban: "Emirates Post Group Licensing will send you the Virtual IBAN for this application. Please wait for it — do not transfer to any other account, and do not use a Virtual IBAN from an earlier application. Your application stays with them while you pay.",
    foot: "This is an automated message — please do not reply to it.",
  },
  ar: {
    subject: (name: string, ref: string) => `${name} — تأكيد (${ref})`,
    greeting: (who: string) => (who ? `عزيزنا ${who}،` : "مرحباً،"),
    submitted: "تم إرسال طلبك.",
    confirmed: "تم تأكيد طلبك واستلام الدفعة.",
    reference: "الرقم المرجعي",
    date: "التاريخ",
    next: "الخطوات التالية:",
    receipt: "تحميل الإيصال",
    receiptHead: "إيصال الدفع",
    receiptNo: "رقم الإيصال",
    amountPaid: "المبلغ المدفوع",
    method: "طريقة الدفع",
    vibanHead: "الدفع عبر التحويل البنكي",
    viban: "سترسل لك مجموعة بريد الإمارات للتراخيص رقم الآيبان الافتراضي الخاص بهذا الطلب. يُرجى انتظاره — ولا تقم بالتحويل إلى أي حساب آخر، ولا تستخدم آيبان افتراضي من طلب سابق. يبقى طلبك لديهم أثناء إتمام الدفع.",
    foot: "هذه رسالة آلية — يُرجى عدم الرد عليها.",
  },
} as const;

export interface CompletionEmailInput {
  agentName: string;
  locale?: string;
  /** What the CUSTOMER quotes: EPGL's LR-37380 rather than the record id. */
  reference: string;
  contactName?: string | null;
  /** The assistant's confirmation message — read for its card and next steps. */
  replyText: string;
  /** The case, for a journey that confirmed without drawing a card. */
  facts: CaseFacts;
  /** Where this deployment answers, so a chat-relative link works in an inbox. */
  baseUrl?: string | null;
  /** The receipt path for a settled payment, or null. */
  receiptPath?: string | null;
  /**
   * The payment itself, when one settled.
   *
   * Asked for on 16 September: "in the email it should also include the receipt
   * details if payment was made". A link to a receipt is not a receipt — it is a
   * request that the customer go and look, from an inbox, possibly on a phone,
   * for a figure they already paid. The numbers travel with the mail; the link
   * stays for the printable version.
   */
  receipt?: { reference: string; amount?: number | null; currency?: string | null; method?: string | null } | null;
}

export function completionEmail(input: CompletionEmailInput): { subject: string; text: string } {
  const s = STR[input.locale === "ar" ? "ar" : "en"];
  const base = (input.baseUrl ?? "").replace(/\/$/, "");

  // The card the customer was shown wins: those rows were written for this
  // journey and already agreed with it. The case is the fallback, not the
  // preference — see the note above summaryRows.
  const card = parseSummaryCard(input.replyText);
  const rows = card?.rows.length ? card.rows : summaryRows(input.facts, input.locale);
  const headline = card?.title?.trim() || (input.facts.payment.status === "paid" ? s.confirmed : s.submitted);

  const link = input.receiptPath ? `${s.receipt}: ${base ? `${base}${input.receiptPath}` : input.receiptPath}` : "";
  /**
   * The receipt, as facts rather than as an errand.
   *
   * Its own block, below the summary: what was paid, what it was paid against,
   * and how — then the link, for the printable copy. Only where money actually
   * settled, so a Virtual IBAN application still says how it WILL be paid and
   * claims no receipt.
   */
  const r = input.receipt;
  const receiptBlock = r
    ? [
        `${s.receiptHead}:`,
        "",
        [
          `${s.receiptNo}: ${r.reference}`,
          ...(typeof r.amount === "number" && r.amount > 0
            ? [`${s.amountPaid}: ${money(r.amount, r.currency, input.locale)}`]
            : []),
          ...(payMethodLabel(r.method, input.locale) ? [`${s.method}: ${payMethodLabel(r.method, input.locale)}`] : []),
          ...(link ? [link] : []),
        ].join("\n"),
      ].join("\n")
    : "";
  const receipt = link;

  // A block of "Label: value" lines, which is what textToHtml renders as a
  // detail table. The reference leads it: an email about an application that
  // never names it is unusable.
  const detail = [
    `${s.reference}: ${input.reference}`,
    ...rows
      // The reference leads the block, so the card's own row for it — "Application
      // reference: LR-37380" — would say it twice under two different names.
      .filter((r) => !/reference|مرجع/i.test(r.label) && r.value.trim() !== input.reference.trim())
      // The receipt is offered once, below, as an address that works from an
      // inbox. The card's row carries the chat-relative path.
      .filter((row) => !(receipt && /receipt|إيصال/i.test(row.label)))
      // And where the receipt block states the amount, the summary does not say
      // it again under a second label.
      .filter((row) => !(r && /payment|amount|paid|الدفع|المبلغ/i.test(row.label)))
      // A bare ISO date is not the format these journeys show dates in — and in
      // an Arabic email the bidi algorithm lays its three numbers out
      // right-to-left, so it reads backwards as well as wrong.
      .map((row) => ({ ...row, value: normaliseDate(row.value) || row.value }))
      .map((r) => `${r.label}: ${stripLinks(r.value)}`),
    // Today, unless the summary already carries today's date under some label of
    // its own — a card that says "Issued: 16-09-2026" does not need "Date:
    // 16-09-2026" under it.
    ...(rows.some((row) => normaliseDate(row.value) === emailDate()) ? [] : [`${s.date}: ${emailDate()}`]),
  ].join("\n");

  /**
   * THE VIRTUAL IBAN IS SENT TO THEM. SAY SO.
   *
   * Reported on the EPGL widget, 21 September. Choosing bank transfer leaves the
   * application submitted and unpaid, and the email says only "Payment: Bank
   * transfer (Virtual IBAN)" — which reads as an instruction to go and transfer
   * something, to an account nobody has given them. The IBAN is issued by
   * Emirates Post Group Licensing afterwards, through a process that does not
   * run on this platform, so the one thing the customer needs to know is that
   * it is coming and that they should wait for it.
   *
   * Only on an application that has NOT settled: once money has arrived the
   * receipt block speaks for itself, and telling someone to await an IBAN they
   * have already used would be worse than saying nothing.
   *
   * Written here rather than left to the model's "what happens next" list. That
   * list is whatever the reply happened to say, and this is the sentence that
   * has to be in every one of these mails.
   */
  const payingByViban =
    String(input.facts.data.payment_method ?? "").toLowerCase() === "viban" &&
    input.facts.payment.status !== "paid";
  const vibanBlock = payingByViban ? [`${s.vibanHead}:`, "", s.viban].join("\n") : "";

  const steps = nextSteps(input.replyText);
  const text = [
    s.greeting(String(input.contactName ?? "").trim()),
    "",
    headline,
    "",
    detail,
    ...(receiptBlock ? ["", receiptBlock] : receipt ? ["", receipt] : []),
    ...(vibanBlock ? ["", vibanBlock] : []),
    ...(steps.length ? ["", s.next, ...steps.map((b) => `- ${b}`)] : []),
    "",
    s.foot,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { subject: s.subject(input.agentName, input.reference), text };
}

/** A card value written as a markdown link, reduced to the address itself. */
function stripLinks(value: string): string {
  return value.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$2").trim();
}

/** The summary card in an assistant message, if it drew one. */
export function parseSummaryCard(text: string): { title: string | null; rows: { label: string; value: string }[]; total: string | null } | null {
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

/** The address the confirmation goes to, or null when there is nothing usable. */
export function completionRecipient(data: Record<string, unknown>): string | null {
  const raw = String(data.contact_email ?? data.applicant_email ?? data.email ?? "").trim();
  return raw && isValidEmail(raw) ? raw : null;
}
