import { isValidEmail } from "./email";

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

const STR = {
  en: {
    subject: (name: string, ref: string) => `${name} — confirmation (${ref})`,
    greeting: (who: string) => (who ? `Dear ${who},` : "Hello,"),
    reference: "Reference",
    receipt: "Download your receipt",
    foot: "This is an automated message — please do not reply to it.",
  },
  ar: {
    subject: (name: string, ref: string) => `${name} — تأكيد (${ref})`,
    greeting: (who: string) => (who ? `عزيزنا ${who}،` : "مرحباً،"),
    reference: "الرقم المرجعي",
    receipt: "تحميل الإيصال",
    foot: "هذه رسالة آلية — يُرجى عدم الرد عليها.",
  },
} as const;

export interface CompletionEmailInput {
  agentName: string;
  locale?: string;
  /** What the CUSTOMER quotes: EPGL's LR-37380 rather than the record id. */
  reference: string;
  contactName?: string | null;
  /** The assistant's confirmation message, as it was sent. */
  replyText: string;
  /** Where this deployment answers, so a chat-relative link works in an inbox. */
  baseUrl?: string | null;
  /** The receipt path for a settled payment, or null. */
  receiptPath?: string | null;
}

export function completionEmail(input: CompletionEmailInput): { subject: string; text: string } {
  const s = STR[input.locale === "ar" ? "ar" : "en"];
  const base = (input.baseUrl ?? "").replace(/\/$/, "");
  const reply = plainFromReply(input.replyText, base || null);
  const receipt =
    input.receiptPath && !reply.includes(input.receiptPath)
      ? `${s.receipt}: ${base ? `${base}${input.receiptPath}` : input.receiptPath}`
      : "";
  // The reference is normally in the card already. Repeated only when it is not:
  // an email about an application that never names it is unusable.
  const ref = input.reference && !reply.includes(input.reference) ? `${s.reference}: ${input.reference}` : "";
  const text = [s.greeting(String(input.contactName ?? "").trim()), "", reply, ref, receipt, "", s.foot]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { subject: s.subject(input.agentName, input.reference), text };
}

/** The address the confirmation goes to, or null when there is nothing usable. */
export function completionRecipient(data: Record<string, unknown>): string | null {
  const raw = String(data.contact_email ?? data.applicant_email ?? data.email ?? "").trim();
  return raw && isValidEmail(raw) ? raw : null;
}
