/**
 * Which document a slot will take, and when the file sitting in it is too old.
 *
 * Both were inline in the upload route and neither could be tested there — a
 * Next route file exports handlers, not helpers. They belong together: the
 * first decides whether this is the right KIND of document, the second whether
 * this copy of it is still good, and an upload has to pass both before any of
 * its data touches the application.
 */
import type { DocType } from "@dialog/core";

/**
 * The document types a slot will accept, or null when the slot names no family
 * we can check against.
 *
 * Matched on the slot's key AND its label, because the two carry different
 * evidence: the key is generated from EPGL's English name and is the same in
 * every locale, while the label is what the customer was actually asked for.
 *
 * ORDER IS THE WHOLE DESIGN. Each test claims the slot for one family, so a
 * specific document has to be tested before the generic one that would also
 * match it — a Form 9 before "financial", an Emirates ID before "passport",
 * an SME licence before "licence".
 */
export function acceptedDocTypes(key: string, label: string): DocType[] | null {
  const k = `${key} ${label}`.toLowerCase();
  if (/emirates.?id|eid|هوية/.test(k)) return ["emirates_id"];
  if (/moa|memorandum|تأسيس/.test(k)) return ["moa"];
  // The specific revenue documents come BEFORE the generic financial/licence
  // tests: a Form 9 slot must not fall through to "financial_statement", and a
  // Form 9 must never satisfy a licence slot (renewal-round feedback).
  if (/form.?0?9|نموذج.?9/.test(k)) return ["form_9"];
  if (/audited|afs|مدقق/.test(k)) return ["audited_financial_statement", "financial_statement"];
  if (/acknowledg|إقرار.?استلام|خطاب/.test(k)) return ["acknowledgement_letter"];
  /**
   * A trial balance names neither "financial" nor "statement", so this slot had
   * no type gate at all and any file whatsoever satisfied it — a passport
   * dropped into "Trial Balance" would have gone green. It is a financial
   * statement in the taxonomy's terms ("an unaudited statement or a plain
   * quarterly trial balance"), so it is gated as one.
   */
  if (/trial.?balance|ميزان.?المراجعة/.test(k)) return ["financial_statement", "audited_financial_statement"];
  if (/financial|statement|مالي/.test(k)) return ["financial_statement", "audited_financial_statement"];
  if (/declaration|undertaking|commitment|تعهد/.test(k)) return ["declaration"];
  // Passport slots had NO rule, so any file at all satisfied one -- an Emirates
  // ID dropped into "Partner 2 — passport copy" was accepted without comment
  // while the reverse was correctly refused. After the Emirates ID test above,
  // so a slot naming both still means the card.
  if (/passport|جواز/.test(k)) return ["passport"];
  /**
   * BEFORE THE LICENCE TEST, BECAUSE AN SME LICENCE IS A LICENCE.
   *
   * EPGL's slot is called "SME Licence (federal or local government)", so the
   * generic test below claimed it and handed it the trade-licence family. The
   * right file was then refused — "This file looks like an Unrecognised
   * document" when the classifier said `other`, since the taxonomy had no name
   * for it — and a real trade licence dropped into the SME slot was waved
   * through, because one rule was answering for two documents.
   *
   * `\bsme\b` will not do: the key is `sme_licence_federal_or_local_government`
   * and an underscore is a word character, so there is no boundary after
   * "sme". The Arabic alternative is belt-and-braces — the key is English in
   * every locale — but the label is what an Arabic session shows.
   */
  if (/(^|[^a-z])sme([^a-z]|$)|الصغيرة\s*والمتوسطة/.test(k)) return ["sme_licence"];
  if (/trade|postal|licen[cs]e|approval|رخصة|موافقة/.test(k)) return ["trade_license", "initial_approval", "postal_license"];
  return null;
}

/**
 * A document whose own printed expiry has already passed, on a slot that owes
 * EPGL a date.
 *
 * The expiry read off a file was checked in two places and neither was general:
 * an identity document, and anything whose extraction filled a licence-expiry
 * field. Everything else went in with a `validTo` in the past, and the push
 * sent it — `sendableDocumentKeys` asks whether there IS a date, never whether
 * it is still good — so Emirates Post received an expired document as though
 * it were current. On the SME licence that is the whole of the eligibility
 * check: the certificate is what says the company still qualifies, and an
 * expired one says the opposite.
 *
 * Scoped to `validityRequired` slots on purpose. They are the ones EPGL refuse
 * without a date, which is the same thing as saying they are the ones where
 * the date is load-bearing; a lease that is six months old is not a reason to
 * refuse a file nobody checks the age of.
 *
 * Returns the expiry date when the file is stale, otherwise null. The caller
 * words the refusal, because a slot that has its own sentence — a trade
 * licence, an Emirates ID — should keep saying it.
 */
export function expiredForSlot(input: {
  validityRequired?: boolean;
  /** The expiry printed on the file, ISO YYYY-MM-DD, as the extractor read it. */
  expiry?: string;
  /** Today, ISO. Passed in so the rule can be tested against a fixed date. */
  today: string;
}): string | null {
  if (!input.validityRequired) return null;
  const expiry = String(input.expiry ?? "");
  // Anything that is not a real ISO date is not evidence of anything. A
  // half-read date must leave the document alone rather than refuse it.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  return expiry < input.today ? expiry : null;
}
