/**
 * Which language the CONVERSATION is in, as opposed to the page it sits on.
 *
 * The widget takes its language from the host page's `<html lang>`, which is
 * right until the customer simply starts typing Arabic on the English site. The
 * model follows them — everything it says comes back in Arabic — while every
 * word the WIDGET owns stays English: the branch picker's "18 to choose from",
 * "Browse nearby branches on a map", "Submission readiness", the composer's
 * "Type your message…". All of those are translated already. None of them were
 * being told.
 *
 * Reported as "the Arabic navigation menu displays a mix of Arabic and English",
 * and from the customer's side that is exactly what it is.
 *
 * Script, not vocabulary. A language guess from words is a guess; Arabic script
 * is Arabic. The ratio matters because one Arabic word in an English sentence —
 * a branch name, a bundle — is not a language change, and flipping the whole
 * interface on it would be worse than leaving it alone.
 */

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
/** Letters of any script, so digits, punctuation and spaces do not count. */
const LETTERS = /[\p{L}]/gu;

/**
 * The language a message is written in, or null when it does not say.
 *
 * Null is the common answer and the important one: "hi", "2290", "ok" and an
 * emoji are not evidence of anything, and a short reply must never flip an
 * interface the customer has been reading happily.
 */
export function messageLocale(text: string | undefined | null): "en" | "ar" | null {
  const s = String(text ?? "");
  const letters = s.match(LETTERS)?.length ?? 0;
  // Below this a message is a token, not a sentence. "نعم" is three letters and
  // unmistakably Arabic, so the floor is low -- but it is not zero.
  if (letters < 3) return null;
  const arabic = s.match(ARABIC)?.length ?? 0;
  const ratio = arabic / letters;
  if (ratio >= 0.5) return "ar";
  // Switching BACK needs to be as easy as switching to it, or a customer who
  // tries one Arabic sentence is stuck in Arabic for the rest of the session.
  if (ratio === 0) return "en";
  return null;
}
