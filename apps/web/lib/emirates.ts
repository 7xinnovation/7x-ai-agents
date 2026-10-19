/**
 * The emirate a piece of text means, as the three-letter code Emirates Post uses.
 *
 * Reported 19 October: "Couldn't load the map" after allowing location, with the
 * branch list above it intact. The map block is written by the MODEL — a line
 * `emirate: <code>`, a line `bundle: <bundle_Id>` — and the guidance asks for
 * the code, but it sometimes writes the name instead. `emirate: Dubai` reached
 * /api/nxn/branches as "DUBAI", which is not one of the seven codes, so the
 * route answered 400 and ChatMap showed its one failure message. Nothing was
 * down: the same request with DXB returns sixteen branches in half a second.
 *
 * Validation the model has to get exactly right is validation that fails in
 * front of a customer. So the name is accepted and turned into the code, here,
 * in one place both the route and the widget read.
 *
 * Al Ain is Abu Dhabi: Emirates Post lists its areas under AUH and has no code
 * of its own for it.
 */

export const EMIRATE_CODES = ["AUH", "DXB", "SHJ", "AJM", "UAQ", "RAK", "FUJ"] as const;
export type EmirateCode = (typeof EMIRATE_CODES)[number];

/** The emirate in words, for a heading that has to say WHICH branches these are. */
export const EMIRATE_LABEL: Record<EmirateCode, { en: string; ar: string }> = {
  AUH: { en: "Abu Dhabi", ar: "أبوظبي" },
  DXB: { en: "Dubai", ar: "دبي" },
  SHJ: { en: "Sharjah", ar: "الشارقة" },
  AJM: { en: "Ajman", ar: "عجمان" },
  UAQ: { en: "Umm Al Quwain", ar: "أم القيوين" },
  RAK: { en: "Ras Al Khaimah", ar: "رأس الخيمة" },
  FUJ: { en: "Fujairah", ar: "الفجيرة" },
};

/**
 * Letters only, so spacing, hyphens and the spellings of Arabic that differ
 * only in their alef or their final taa all land on the same key:
 * "Abu Dhabi", "abu-dhabi" and "ABUDHABI" are one word; so are "الشارقة" and
 * "الشارقه".
 */
function key(s: string): string {
  return s
    .trim()
    .toLowerCase()
    // Arabic diacritics and the tatweel carry no distinction here.
    .replace(/[ؗ-ًؚ-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىئ]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Every spelling seen in a map block, a tool argument or a customer's message. */
const BY_NAME: Record<string, EmirateCode> = {};
for (const [code, names] of Object.entries({
  AUH: ["Abu Dhabi", "Abudhabi", "Abu Zabi", "Abu Dhabi Emirate", "Al Ain", "Alain", "أبوظبي", "أبو ظبي", "العين"],
  DXB: ["Dubai", "Dubayy", "Dubai Emirate", "دبي"],
  SHJ: ["Sharjah", "Al Sharjah", "Shariqah", "الشارقة", "شارقة"],
  AJM: ["Ajman", "عجمان"],
  UAQ: ["Umm Al Quwain", "Umm Al Qaiwain", "Umm Al Quwayn", "Umm Al Qaywayn", "أم القيوين", "ام القيوين"],
  RAK: ["Ras Al Khaimah", "Ras Al Khaima", "Ras Alkhaimah", "Ras El Khaimah", "رأس الخيمة", "راس الخيمة"],
  FUJ: ["Fujairah", "Al Fujairah", "Fujeirah", "Fujayrah", "الفجيرة", "الفجيره"],
} as Record<EmirateCode, string[]>)) {
  for (const n of names) BY_NAME[key(n)] = code as EmirateCode;
}

/**
 * The code, or null when the text names no emirate we serve. A code is returned
 * as it was given; a name is translated; anything else is nobody's emirate and
 * the caller says so rather than guessing.
 */
export function toEmirateCode(input: string | null | undefined): EmirateCode | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if ((EMIRATE_CODES as readonly string[]).includes(upper)) return upper as EmirateCode;
  return BY_NAME[key(raw)] ?? null;
}
