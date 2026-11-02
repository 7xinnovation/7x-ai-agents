import { getAnthropic, classifierModel, extractionModel, withModelFallback } from "@dialog/core";
import { log } from "@/lib/logger";

/**
 * THE VOICE SPEAKS EMIRATI; THE TEXT STAYS FORMAL.
 *
 * 2 November 2026. Fourteen Arabic samples later, the verdict was "all of them
 * are robotic". They were: every one was reading Modern Standard Arabic, the
 * register of news bulletins and official letters, and no voice makes that
 * sound like a person at a counter in Deira. The words were the problem, not
 * only the voice. So each Arabic sentence is rewritten into Emirati dialect
 * just before it is spoken — the customer READS the formal reply and HEARS an
 * Emirati one — and the rewrite is held to the facts: every number, every
 * name, every Latin word of the original must survive, or the original is
 * spoken instead.
 *
 * Emirati, not Saudi. "تبي" is Saudi; an Emirati says "تبا". The prompt
 * carries the glossary, and the output is checked against a blocklist of the
 * Saudi, Egyptian and Levantine forms that models reach for when asked for
 * "Gulf" Arabic; the commonest are corrected outright, the rest send the
 * sentence back to the original.
 */

/**
 * A word, as a whole word in Arabic text. JavaScript's \b knows only Latin
 * letters, so it is useless here: the boundary is "no Arabic letter on either
 * side", and a clitic prefix (و، ف) is allowed and kept.
 */
function word(w: string): [RegExp, string] {
  return [new RegExp(`(?<![\\u0600-\\u06FF])([وف]?)${w}(?![\\u0600-\\u06FF])`, "g"), w];
}

/** Forms that are not Emirati — the pattern, the word, and the Emirati word to say instead. */
const NOT_EMIRATI: Array<[[RegExp, string], string]> = [
  // want — Saudi/Najdi
  [word("تبي"), "تبا"], [word("تبغى"), "تبا"], [word("تبغي"), "تبين"], [word("أبغى"), "أبا"], [word("ابغى"), "أبا"], [word("أبغي"), "أبا"],
  [word("ودك"), "تبا"], [word("ودي"), "أبا"], [word("يبغى"), "يبا"], [word("نبغى"), "نبا"],
  // what — Saudi/Hijazi
  [word("وش"), "شو"], [word("ايش"), "شو"], [word("إيش"), "شو"],
  // very — Levantine spelling
  [word("كتير"), "وايد"],
  // because / yes / now — Egyptian & Levantine
  [word("علشان"), "عشان"], [word("أيوه"), "إي"], [word("ايوه"), "إي"], [word("دلوقتي"), "الحين"], [word("هلأ"), "الحين"],
  // like this — Saudi
  [word("كذا"), "جذي"],
];

/** The non-Emirati words in a text, for the test and the log. */
export function notEmirati(text: string): string[] {
  const found: string[] = [];
  for (const [[re, w]] of NOT_EMIRATI) { re.lastIndex = 0; if (re.test(text)) found.push(w); }
  return [...new Set(found)];
}

/** The commonest slips corrected in place. */
export function fixDialect(text: string): string {
  let out = text;
  for (const [[re], to] of NOT_EMIRATI) { re.lastIndex = 0; out = out.replace(re, `$1${to}`); }
  return out;
}

const digits = (s: string) => s.match(/\d+/g) ?? [];
/** Latin tokens that must survive a rewrite — names and codes, not the currency and tax words, which may become Arabic. */
const latin = (s: string) => (s.match(/[A-Za-z][A-Za-z0-9.+-]*/g) ?? []).filter((w) => !/^(AED|VAT)$/i.test(w));
const arabicLetters = (s: string) => (s.match(/[؀-ۿ]/g) ?? []).length;

/**
 * Did the rewrite keep the facts? Every digit run and every Latin token of the
 * original must appear in the rewrite, it must still be Arabic, and it must
 * not have grown into a speech of its own.
 */
export function keepsTheFacts(src: string, out: string): boolean {
  if (!out.trim()) return false;
  for (const d of digits(src)) if (!out.includes(d)) return false;
  for (const w of latin(src)) if (!out.includes(w)) return false;
  if (arabicLetters(out) < arabicLetters(src) / 2) return false;
  if (out.length > src.length * 2 + 40) return false;
  return true;
}

export const DIALECT_INSTRUCTION =
  "You rewrite one sentence of a customer-service reply from Modern Standard Arabic into natural spoken EMIRATI Arabic (the dialect of Dubai, Abu Dhabi and Sharjah), for a voice assistant called ميره at Emirates Post (بريد الإمارات).\n" +
  "It must sound like a friendly, polite Emirati agent talking — not a news reader, and NOT Saudi, Egyptian or Levantine.\n" +
  "EMIRATI, NOT SAUDI. Use: تبا / تبين (you want), أبا / بغيت (I want), شو (what), وايد (very), الحين (now), زين / تمام (fine), ما عليه (no problem), إي (yes), شحالك (how are you), هلا وغلا / حياك الله (welcome), بعد (also), عشان (because), جذي (like this), سير (go), فيه (there is), تفضل, لو سمحت.\n" +
  "NEVER use: تبي, تبغى, أبغى, ودك, وش, ايش, كتير, علشان, أيوه, كذا, دلوقتي, هلأ.\n" +
  "Rules:\n" +
  "- Keep the meaning EXACTLY. Do not add, drop, soften or embellish anything. One sentence in, one sentence out (two at most if the original has two).\n" +
  "- Keep every number, price, date, box number, reference and Latin word exactly as written (MyBox, MyHome, Noqodi, UAE PASS, AED). Digits stay digits.\n" +
  "- The assistant's name is ميره — never ميرا or ميرة. Emirates Post is بريد الإمارات.\n" +
  "- Address the customer in the masculine unless the sentence clearly addresses a woman.\n" +
  "- Plain words only: no markdown, no emoji, no quotation marks, no comments.\n" +
  "- If the sentence is already Emirati, or is only a number or a name, return it unchanged.\n" +
  "Examples:\n" +
  "كيف يمكنني مساعدتك اليوم؟ → شو أقدر أساعدك اليوم؟\n" +
  "هل ترغب بتجديده الآن؟ → تبا تجدده الحين؟\n" +
  "يمكنك الدفع بالبطاقة المحفوظة أو عبر Noqodi. → تقدر تدفع بالبطاقة المحفوظة أو عن طريق Noqodi.\n" +
  "هل ترغب في إضافة خدمة MyHome لتوصيل البريد إلى منزلك مقابل 300 درهم سنوياً؟ → تبا نضيف لك خدمة MyHome عشان نوصّل لك البريد لبيتك بـ 300 درهم في السنة؟\n" +
  "جارٍ التحقق من بيانات حسابك. → ثواني، أشيّك على بيانات حسابك.\n" +
  "الرجاء إدخال رقم صندوق البريد. → عطني رقم صندوق البريد لو سمحت.\n" +
  "Return ONLY the rewritten sentence.";

/** How long one rewrite may take: the first word of a reply waits on it. */
const TIMEOUT_MS = 7000;
const CACHE_MAX = 300;
const cache = new Map<string, string>();

/**
 * The model: VOICE_DIALECT_MODEL, else the main model. Compared on six
 * sentences: the fast model is a second quicker and nearly as good; the main
 * one is the more idiomatic ("خلص تاريخه", "لسنة وحدة"), and dialect is the
 * whole point here. "fast" picks the classifier model.
 */
function dialectModel(): string {
  const v = process.env.VOICE_DIALECT_MODEL?.trim();
  if (!v || v === "main") return extractionModel();
  if (v === "fast") return classifierModel();
  return v;
}

/**
 * The sentence, in Emirati. Best effort: on any doubt the original comes back,
 * so a rewrite can never silence a reply or change what it says.
 */
export async function toEmirati(text: string): Promise<{ text: string; rewritten: boolean }> {
  const src = text.trim();
  if (!src || arabicLetters(src) < 3) return { text: src, rewritten: false };
  const hit = cache.get(src);
  if (hit !== undefined) return { text: hit, rewritten: hit !== src };
  try {
    const client = getAnthropic();
    const res = await withModelFallback(dialectModel(), (model) => client.messages.create({
      model,
      max_tokens: 400,
      messages: [{ role: "user", content: `${DIALECT_INSTRUCTION}\n\nSENTENCE:\n${src}` }],
    }, { timeout: TIMEOUT_MS, maxRetries: 0 }));
    const raw = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("").trim();
    const out = fixDialect(raw.replace(/^["'«»]+|["'«»]+$/g, "").trim());
    const slips = notEmirati(out);
    if (!keepsTheFacts(src, out) || slips.length) {
      log.warn("voice_dialect_rejected", { reason: slips.length ? `not Emirati: ${slips.join(" ")}` : "facts changed", src: src.slice(0, 120), out: out.slice(0, 120) });
      remember(src, src);
      return { text: src, rewritten: false };
    }
    remember(src, out);
    return { text: out, rewritten: out !== src };
  } catch (e) {
    log.warn("voice_dialect_failed", { reason: e instanceof Error ? e.message : String(e) });
    return { text: src, rewritten: false };
  }
}

function remember(k: string, v: string) {
  if (cache.size >= CACHE_MAX) { const first = cache.keys().next().value; if (first !== undefined) cache.delete(first); }
  cache.set(k, v);
}
