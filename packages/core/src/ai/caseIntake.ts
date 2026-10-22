/**
 * What kind of case this is, and what we already know to put on it.
 *
 * Emirates Post's CRM takes more than a name and a sentence. `caseType` is a
 * picklist — Inquiry, Complaint, Feedback, Compliment — and their queue routes
 * and reports on it. `emirateCode`, `poBoxNumber` and `trackingNumber` are the
 * fields an officer would otherwise ring the customer back to ask for.
 *
 * Every one of them was going across empty, with `caseType` hardcoded to
 * Inquiry: a complaint about a lost parcel arrived in their system looking
 * exactly like a question about opening hours.
 *
 * So they are read from what the customer actually said, and from what the
 * journey already holds. Two rules throughout:
 *
 *  1. INQUIRY IS THE DEFAULT AND SILENCE MEANS INQUIRY. Mislabelling a question
 *     as a complaint inflates the number their team is measured on; the reverse
 *     buries a real one. Neither is worth guessing at, so the signal has to be
 *     explicit.
 *  2. A FIELD WE ARE NOT SURE OF IS LEFT EMPTY. An empty optional field costs a
 *     question on the callback. A wrong one sends an officer to the wrong box,
 *     the wrong parcel, or the wrong emirate.
 */

export type EpCaseType = "Inquiry" | "Complaint" | "Feedback" | "Compliment";

/** Emirate codes as their contact form spells them. */
const EMIRATES: Array<[RegExp, string]> = [
  [/\b(abu ?dhabi|abudhabi|auh)\b|أبو ?ظبي/i, "AUH"],
  [/\b(dubai|dxb)\b|دبي/i, "DXB"],
  [/\b(sharjah|shj)\b|الشارقة|الشارقه/i, "SHJ"],
  [/\b(ajman|ajm)\b|عجمان/i, "AJM"],
  [/\b(umm al ?quwain|uaq)\b|أم ?القيوين|ام ?القيوين/i, "UAQ"],
  [/\b(ras al ?khaimah|rak)\b|رأس ?الخيمة|راس ?الخيمة/i, "RAK"],
  [/\b(fujairah|fuj)\b|الفجيرة|الفجيره/i, "FUJ"],
  [/\b(al ?ain)\b|العين/i, "AUH"], // Al Ain is in the Abu Dhabi emirate.
];

const norm = (s: string | undefined) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Which of their four case types this is.
 *
 * Checked in order of what it costs to get wrong. A complaint buried in a
 * compliment ("the staff were lovely but my parcel never came") is a complaint;
 * the reverse reading loses the thing that needs fixing.
 */
export function caseTypeFrom(text: string | undefined): EpCaseType {
  const t = norm(text);
  if (!t) return "Inquiry";

  const complaint =
    /\b(complain(t|ts|ing)?|complaint)\b/.test(t) ||
    /\b(lost|missing|stolen|damaged|broken|destroyed)\b[^.?!]{0,30}\b(parcel|package|item|shipment|mail|box|delivery)\b/.test(t) ||
    /\b(parcel|package|shipment|delivery|mail)\b[^.?!]{0,30}\b(lost|missing|damaged|never (arrived|came|delivered)|not (arrived|delivered|received))\b/.test(t) ||
    /\b(still (have ?)?not|havent|have not|never)\b[^.?!]{0,25}\b(received|arrived|delivered|refunded|been contacted)\b/.test(t) ||
    /\b(unacceptable|appalling|disgraceful|terrible|awful|horrible|worst|rude|disrespectful)\b/.test(t) ||
    /\b(very |extremely |really )?(disappointed|frustrated|furious|angry)\b/.test(t) ||
    /\b(no ?one|nobody)\b[^.?!]{0,25}\b(responded|replied|answered|called|helped|got back)\b/.test(t) ||
    /\b(refund|compensation|escalate this|take this further)\b/.test(t) ||
    /\b(overcharged|charged twice|double ?charged|wrongly charged)\b/.test(t) ||
    /شكوى|أشتكي|اشتكي|غير مقبول|سيء|سيئة|متضرر|لم (أستلم|استلم|يصل)/.test(t);
  if (complaint) return "Complaint";

  const compliment =
    /\b(compliment|commend|praise)\b/.test(t) ||
    /\b(excellent|outstanding|wonderful|fantastic|brilliant|amazing|exceptional)\b[^.?!]{0,30}\b(service|staff|team|experience|work)\b/.test(t) ||
    /\b(service|staff|team|experience)\b[^.?!]{0,30}\b(excellent|outstanding|wonderful|fantastic|brilliant|amazing|exceptional|great|very good)\b/.test(t) ||
    /\b(well done|great job|keep it up|very helpful|extremely helpful|thank(s| you)? (so much|very much))\b[^.?!]{0,40}\b(staff|team|service|he|she|they)\b/.test(t) ||
    /شكر|ممتاز|رائع|أحسنتم|احسنتم/.test(t);
  if (compliment) return "Compliment";

  const feedback =
    /\b(feedback|suggestion|suggest(ing)?|recommend(ation)?)\b/.test(t) ||
    /\b(you|it) (should|could|ought to|might want to)\b[^.?!]{0,40}\b(add|change|improve|consider|offer|allow)\b/.test(t) ||
    /\b(would be (better|good|great|helpful)|it would help) if\b/.test(t) ||
    /اقتراح|أقترح|اقترح|ملاحظة|تحسين/.test(t);
  if (feedback) return "Feedback";

  return "Inquiry";
}

/**
 * An Emirates Post tracking number, as their own form validates it.
 *
 * Two letters, nine digits, two letters — `EP123456789AE`. Anything looser
 * matches order references and Emirates IDs, which an officer would then chase
 * as a shipment.
 */
export function trackingNumberFrom(text: string | undefined): string {
  const m = String(text ?? "").toUpperCase().match(/\b([A-Z]{2}\d{9}[A-Z]{2})\b/);
  return m ? m[1]! : "";
}

/**
 * The PO Box number, from the journey first and the sentence second.
 *
 * The journey's own value is authoritative — it was typed into a field and
 * validated. The sentence is only read when it says what the number IS, because
 * a callback about a renewal fee is full of numbers that are not box numbers.
 */
export function poBoxNumberFrom(text: string | undefined, data?: Record<string, unknown>): string {
  for (const key of ["po_box_number", "poBoxNumber", "box_number", "pobox", "po_box"]) {
    const v = data?.[key];
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "string" && /^\d{3,6}$/.test(v.trim())) return v.trim();
  }
  const t = String(text ?? "");
  // \b does not fire either side of Arabic script, so that alternative is its own.
  const m =
    t.match(/\b(?:p\.? ?o\.? ?box|box)\b[^\d]{0,12}(\d{3,6})\b/i) ??
    t.match(/صندوق(?: بريد)?[^\d]{0,12}(\d{3,6})/);
  return m ? m[1]! : "";
}

/** The emirate, from the journey first and the sentence second. */
export function emirateCodeFrom(text: string | undefined, data?: Record<string, unknown>): string {
  for (const key of ["emirate", "emirate_code", "emirateCode", "city"]) {
    const v = data?.[key];
    if (typeof v !== "string" || !v.trim()) continue;
    const direct = v.trim().toUpperCase();
    if (/^(AUH|DXB|SHJ|AJM|UAQ|RAK|FUJ)$/.test(direct)) return direct;
    for (const [re, code] of EMIRATES) if (re.test(v)) return code;
  }
  for (const [re, code] of EMIRATES) if (re.test(String(text ?? ""))) return code;
  return "";
}

export interface EpCaseIntake {
  caseType: EpCaseType;
  emirateCode: string;
  poBoxNumber: string;
  trackingNumber: string;
}

/** Everything above, read once from the customer's words and the journey. */
export function caseIntakeFrom(text: string | undefined, data?: Record<string, unknown>): EpCaseIntake {
  return {
    caseType: caseTypeFrom(text),
    emirateCode: emirateCodeFrom(text, data),
    poBoxNumber: poBoxNumberFrom(text, data),
    trackingNumber: trackingNumberFrom(text),
  };
}
