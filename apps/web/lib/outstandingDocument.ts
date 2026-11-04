/**
 * When the model asks for the wrong document, end the reply with the right one.
 *
 * 4 November, pack 12. The lease contract was outstanding and the model asked
 * instead for documents that were already in. `collectedUploadGuard` did its
 * job — a file already on the case is not asked for twice — so each of those
 * controls was rewritten into "already uploaded" and the reply ended with
 * nothing to press. The customer said "please continue"; the model did the same
 * thing again. Six times, and then it gave up and raised a callback case in
 * EPGL's sandbox for an application that was one document short.
 *
 * The existing repair (FB-1425) appends controls when a reply MENTIONS
 * uploading and carries no block. These replies did carry a block — the wrong
 * one — so it never fired.
 *
 * WHY THIS IS SAFE WHERE APPENDING WAS NOT. The stray boxes of 15 September
 * came from a control the prose never named: the words said one document, the
 * box offered another, and one of them was optional. Here both halves are
 * written together — the sentence names the document the control asks for, and
 * the control is for the slot readiness says is outstanding. Nothing is guessed.
 *
 * It fires only after the model has already misfired. A reply that asked for
 * nothing, or that told the customer the document can wait, is left alone: the
 * first is not a loop, and arguing with the second is the 15 September failure
 * from the other direction.
 */
import { defersUpload } from "./uploadGuard";

export interface Outstanding {
  key: string;
  /** What the customer is to be asked for, in their language. */
  label: string;
}

export function askFor(label: string, locale: "en" | "ar"): string {
  return locale === "ar" ? `ما زلت بحاجة إلى ${label}.` : `What I still need is the ${label}.`;
}

export function outstandingBlock(doc: Outstanding, locale: "en" | "ar"): string {
  return `\n\n${askFor(doc.label, locale)}\n\n\`\`\`upload\nkey: ${doc.key}\n\`\`\`\n`;
}

/**
 * The text to append, or null to leave the reply as it is.
 *
 * `suppressed` is the trigger: it means this reply contained an upload control
 * that the guard took away, which is the model asking for something already in.
 */
export function outstandingNudge(input: {
  prose: string;
  outstanding: Outstanding | null;
  locale: "en" | "ar";
  suppressed: boolean;
}): string | null {
  const { prose, outstanding, locale, suppressed } = input;
  if (!suppressed || !outstanding?.key || !outstanding.label) return null;
  // The model let the customer off this document. Do not put the hook back.
  if (defersUpload(prose)) return null;
  // A live control for this very slot is already there; two would be absurd.
  if (new RegExp(`\`\`\`upload[^\`]*key:\\s*${outstanding.key}\\b`).test(prose)) return null;
  return outstandingBlock(outstanding, locale);
}
