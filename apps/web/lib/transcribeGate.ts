/**
 * WHEN A TRANSCRIPT IS NOT WHAT THE CUSTOMER SAID.
 *
 * 2 November 2026. Verifying production, one second of pure silence came back
 * from the transcriber as "How can I get a PO Box?". Measured properly, with
 * token confidences asked for (`include[]=logprobs`):
 *
 *   real speech (two clips)   avg log-prob -0.009 / -0.002   worst token -0.08
 *   silence                   avg -0.42   →  "renew my PO Box"
 *   hiss (room-noise-like)    avg -0.41   →  "rent a new PO Box"
 *   50 Hz hum                 avg -1.02   →  "MyBox."
 *
 * Handed nothing to hear, the model hears the hint it was given — the domain
 * prompt listed those very phrases — and says so with a confidence it never
 * shows for a person. Three things follow, all here:
 *
 *  1. A transcript whose average confidence is under the bar is not a
 *     transcript. The bar sits far from real speech and well above noise.
 *  2. A transcript that is nothing but the hint's own vocabulary, with less
 *     than near-perfect confidence, is the hint coming back.
 *  3. The hint is a VOCABULARY now, not a list of sentences — names and terms
 *     the customer might use — so there is no sentence to echo.
 *
 * The scores travel back in a response header, so the bar can be re-set from
 * what real customers score rather than from synthetic clips.
 */

export interface TokenLogprob { token?: string; logprob?: number }

export interface Confidence { avg: number; min: number; tokens: number }

/** Average and worst token log-probability; null when the service sent none. */
export function confidence(logprobs: TokenLogprob[] | undefined | null): Confidence | null {
  if (!Array.isArray(logprobs) || !logprobs.length) return null;
  const lps = logprobs.map((t) => (typeof t?.logprob === "number" ? t.logprob : 0));
  return { avg: lps.reduce((a, b) => a + b, 0) / lps.length, min: Math.min(...lps), tokens: lps.length };
}

/** Under this average, the model was guessing. Real speech scores around -0.01; noise -0.3 and below. */
export const REJECT_AVG = -0.25;
/** A short transcript — a few tokens — must be surer than that, because that is the shape of a hallucination. */
export const REJECT_SHORT_AVG = -0.12;
export const SHORT_TOKENS = 5;
/** Vocabulary echoed back is accepted only with near-perfect confidence. */
export const ECHO_AVG = -0.05;

/** Terms a customer might say. Names and nouns only — never a sentence the model could repeat. */
export const VOCABULARY: Record<"en" | "ar", string[]> = {
  en: [
    "Emirates Post", "PO Box", "MyBox", "MyHome", "MyHome Instant", "Basic", "Premium", "Corporate",
    "Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah", "Deira", "Al Barsha",
    "Emirates ID", "trade licence", "Noqodi", "UAE PASS", "Mira", "auto-renewal", "representative", "branch", "box number", "AED", "dirhams",
  ],
  ar: [
    "بريد الإمارات", "صندوق بريد", "صندوق البريد", "ماي بوكس", "ماي هوم", "MyBox", "MyHome",
    "دبي", "أبوظبي", "الشارقة", "عجمان", "أم القيوين", "رأس الخيمة", "الفجيرة", "ديرة", "البرشاء",
    "الهوية الإماراتية", "الرخصة التجارية", "نقودي", "الهوية الرقمية", "ميره", "التجديد التلقائي", "الفرع", "رقم الصندوق", "درهم", "تجديد", "استئجار",
  ],
};

/** The hint handed to the transcriber for a language. */
export function vocabularyPrompt(locale: "en" | "ar"): string {
  return locale === "ar"
    ? `مفردات خدمة صناديق بريد الإمارات: ${VOCABULARY.ar.join("، ")}.`
    : `Emirates Post PO Box service vocabulary: ${VOCABULARY.en.join(", ")}.`;
}

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** Is the transcript made only of the hint's own words? That is the hint coming back, not a customer. */
export function echoesVocabulary(text: string, locale: "en" | "ar"): boolean {
  const ws = words(text);
  if (!ws.length) return true;
  const vocab = new Set(VOCABULARY.en.concat(VOCABULARY.ar).flatMap(words));
  // The little words a hallucinated phrase is glued together with.
  for (const w of ["a", "the", "my", "to", "i", "want", "new", "renew", "rent", "track", "shipment", "get", "can", "how", "and", "or", "of", "in", "for", "please", "في", "من", "على", "أريد", "ابي", "لو", "سمحت"]) vocab.add(w);
  return ws.every((w) => vocab.has(w));
}

export interface Verdict { accept: boolean; reason: string | null; confidence: Confidence | null }

/** Accept the transcript, or say why not. No confidences at all means accept — the old behaviour. */
export function judge(text: string, logprobs: TokenLogprob[] | undefined | null, locale: "en" | "ar"): Verdict {
  const t = text.trim();
  if (!t) return { accept: false, reason: "empty", confidence: null };
  const c = confidence(logprobs);
  if (!c) return { accept: true, reason: null, confidence: null };
  if (c.avg < REJECT_AVG) return { accept: false, reason: "low-confidence", confidence: c };
  if (c.tokens <= SHORT_TOKENS && c.avg < REJECT_SHORT_AVG) return { accept: false, reason: "short-and-unsure", confidence: c };
  if (c.avg < ECHO_AVG && echoesVocabulary(t, locale)) return { accept: false, reason: "vocabulary-echo", confidence: c };
  return { accept: true, reason: null, confidence: c };
}
