/**
 * Where a customer goes with a question after the transaction is done.
 *
 * Emirates Post asked for their FAQ to close every completed PO Box journey —
 * the point at which the chat has nothing left to do for them and they may
 * still have questions nobody thought to answer. It is added on the way out, on
 * the turn the journey completes, in the language the conversation was held in.
 *
 * Once. The receipt link taught this: a closing line that repeats stops reading
 * as the end of something and starts reading as the assistant not knowing where
 * it is.
 */
const FAQ: Record<string, { url: string; text: string }> = {
  en: { url: "https://www.emiratespost.ae/faq", text: "Any questions? Emirates Post's FAQ" },
  ar: { url: "https://www.emiratespost.ae/ar/faq", text: "لديك سؤال؟ الأسئلة الشائعة لبريد الإمارات" },
};

/** The URL alone. */
export function faqUrl(locale: string | undefined): string {
  return (FAQ[locale === "ar" ? "ar" : "en"] ?? FAQ.en!).url;
}

/**
 * Does this reply already point at the FAQ?
 *
 * Either language counts. The model is asked to put the link in the confirmation
 * card itself, and if it does, adding a second one underneath is the assistant
 * saying the same thing twice — including when it reached for the English page
 * in an Arabic conversation, which a check on one exact URL would miss.
 */
export function mentionsFaq(text: string): boolean {
  return /emiratespost\.ae\/(?:ar\/)?faq/i.test(text);
}

export function faqLine(locale: string | undefined): string {
  const f = FAQ[locale === "ar" ? "ar" : "en"] ?? FAQ.en!;
  return `\n\n[${f.text}](${f.url})`;
}

/**
 * Is this the turn a journey finished?
 *
 * Finished means Emirates Post has the transaction: a submission reference came
 * back this turn, or the payment settled this turn on a journey that has no
 * separate submission. Not "the case has a reference" — that stays true for
 * every reply afterwards, which is exactly how "Download your receipt" ended up
 * under an answer about issuing authorities.
 */
export function journeyJustCompleted(input: {
  submittedThisTurn: boolean;
  paymentBefore?: { status?: string; reference?: string | null } | null;
  paymentAfter?: { status?: string; reference?: string | null } | null;
}): boolean {
  if (input.submittedThisTurn) return true;
  const after = input.paymentAfter;
  if (after?.status !== "paid" || !after.reference) return false;
  const before = input.paymentBefore;
  return before?.status !== "paid" || before.reference !== after.reference;
}
