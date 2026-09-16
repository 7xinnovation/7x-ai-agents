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
 * Things that are written in Latin script whatever language you are speaking.
 *
 * An email address, a web address, a reference, a phone number, a licence
 * number. Removed before the language is judged — otherwise the customer's own
 * contact details are read as a sentence in English.
 */
const NOT_A_SENTENCE = /[\w.+-]+@[\w.-]+|https?:\/\/\S+|\b[A-Z]{2,}-?\d[\w-]*|\+?\d[\d\s()-]{5,}/g;

/** Words in any script. */
const words = (s: string) => s.match(/\p{L}+/gu) ?? [];

/**
 * The scaffolding of an English sentence.
 *
 * Script settles Arabic and cannot settle English: a company name, a branch, a
 * person and an address are all written in Latin letters whatever language the
 * conversation is in. What a SENTENCE has and a name does not is grammar, and
 * this is the cheapest evidence of grammar there is. "YI FANG TAIWAN FRUIT TEA
 * L.L.C" is five words of English letters and none of them is one of these.
 *
 * Deliberately small. Missing a genuine English sentence costs the customer
 * nothing they cannot fix by saying so — the assistant still answers — while a
 * false positive silently changes the language of an interface they are reading
 * happily, which is the bug this exists for.
 */
const ENGLISH_GRAMMAR = new Set([
  "i", "me", "my", "we", "our", "you", "your", "it", "its", "this", "that", "these", "those",
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "do", "does", "did", "can",
  "could", "will", "would", "should", "have", "has", "had", "want", "need", "like", "please",
  "how", "what", "when", "where", "why", "which", "who", "and", "or", "but", "for", "with",
  "to", "in", "on", "of", "at", "from", "not", "no", "yes", "ok", "okay", "thanks", "thank",
  "hello", "hi", "there", "again", "still", "about", "help", "english",
]);

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
  if (ratio > 0) return null;
  /**
   * NOTHING ARABIC IN IT IS NOT THE SAME AS "IN ENGLISH".
   *
   * 16 September, an Arabic application: the assistant asked for the applicant's
   * name and email, the customer answered "emre karayalcin,
   * emre.karayalcin@7x.ae, 0553708434" — their own name, their own address, in
   * the only script either can be written in — and the whole interface switched
   * to English for the rest of the session while they were still typing Arabic.
   *
   * So switching BACK asks for a sentence: contact details, reference numbers
   * and proper nouns are stripped, and what is left has to read as several
   * words. Three is enough for "I prefer English" or "can you help" and not
   * enough for a name.
   */
  const rest = s.replace(NOT_A_SENTENCE, " ");
  // A NAME SHOUTED IS STILL A NAME. Company names arrive in capitals off a trade
  // licence and get pasted back as answers.
  if (rest === rest.toUpperCase() && /\p{Lu}/u.test(rest)) return null;
  const w = words(rest).map((x) => x.toLowerCase());
  return w.length >= 2 && w.some((x) => ENGLISH_GRAMMAR.has(x)) ? "en" : null;
}
