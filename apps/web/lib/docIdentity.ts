/**
 * Does an uploaded document belong to the company on this application, and is
 * the licence it describes still valid?
 *
 * THE BUG THIS FIXES. A customer uploaded the MOA for YIFANG CAFE MIDDLE EAST
 * L.L.C against an application reading YI FANG TAIWAN FRUIT TEA L.L.C, and it
 * was refused as the wrong company's document. Both are correct. In the UAE a
 * company's REGISTERED name and its TRADE name are different strings, printed on
 * different documents: the MOA carries the legal name, the trade licence leads
 * with the trade name. Comparing whichever one happened to land in `company_name`
 * against whichever one the next document happened to yield rejects perfectly
 * matched paperwork, and the customer is told their own MOA is somebody else's.
 *
 * So a name is now compared against EVERY name we hold for the company, and only
 * refused when it matches none of them. And a matching trade licence NUMBER ends
 * the question outright -- it is an exact identifier, where names are a spelling
 * exercise ("YI FANG" and "YIFANG" are the same company).
 *
 * The client's validation sheet does want a genuine name mismatch to stop the
 * application, and it still does. What it should never have stopped is a legal
 * name sitting beside a trade name.
 */

/** Fields that can legitimately hold one of a company's names. */
const NAME_FIELDS = ["company_name", "company_name_ar", "trade_name_en", "trade_name_ar"] as const;

/**
 * Exact identifiers. A mismatch here is a genuinely different company or person,
 * so it blocks -- these are numbers, not spellings, and the client's validation
 * sheet asks for the application to stop.
 */
const ID_FIELDS: { key: string; label: string; settles: "company" | "person" }[] = [
  { key: "trade_license_number", label: "trade licence number", settles: "company" },
  { key: "postal_license_number", label: "postal licence number", settles: "company" },
  // From the sheet: passport number cross-referenced between EID/passport and
  // the MOA, and the Emirates ID number checked against the card.
  { key: "owner_passport_no", label: "passport number", settles: "person" },
  { key: "owner_emirates_id", label: "Emirates ID number", settles: "person" },
];

/**
 * Person fields that are compared but never blocked on.
 *
 * The sheet wants the owner's name verified against the Emirates ID and
 * passport, and the nationality against the MOA. Both are strings people
 * transliterate differently on purpose -- MOHAMMED and MUHAMMAD are one man, and
 * "UAE", "U.A.E." and "United Arab Emirates" are one country. Blocking on those
 * would repeat the MOA mistake with a person's name instead of a company's, so
 * the disagreement is put to the customer.
 */
const PERSON_NAME_FIELDS = ["owner_name", "owner_name_ar"] as const;
const PERSON_SOFT_FIELDS: { key: string; label: string }[] = [
  { key: "owner_nationality", label: "nationality" },
];

/** Legal-form suffixes and filler that differ between documents for one company. */
const NOISE = /\b(l\.?l\.?c|f\.?z\.?e|f\.?z\.?c|fz|llc|est|establishment|company|co|trading|general|branch|sole|proprietorship|one person)\b/gi;

export function normaliseName(raw: string): string {
  return raw.replace(NOISE, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

function normaliseId(raw: string): string {
  return raw.replace(/[^0-9a-z]/gi, "").toLowerCase();
}

/** The normalised values a source holds for a set of fields. */
function pick(source: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields
    .map((k) => source[k])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 1)
    .map(normaliseName)
    .filter(Boolean);
}

/** The first readable value, as printed, for showing the customer. */
function raw(source: Record<string, unknown>, fields: readonly string[]): string {
  return fields.map((k) => source[k]).find((v): v is string => typeof v === "string" && v.trim().length > 1) ?? "";
}

function names(source: Record<string, unknown>): string[] {
  return NAME_FIELDS.map((k) => source[k])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 1)
    .map(normaliseName)
    .filter(Boolean);
}

/** Same company if either name contains the other -- "YI FANG" vs "YIFANG TAIWAN". */
function nameMatches(a: string, b: string): boolean {
  return a === b || a.includes(b) || b.includes(a);
}

export interface EntityConflict {
  /**
   * `block` -- an exact identifier disagrees, so this is provably another
   * company's document and the application stops, as the client's sheet requires.
   *
   * `confirm` -- only NAMES disagree, and we hold no licence number on either
   * side to settle it. That is exactly the YIFANG case: a registered name beside
   * a trade name looks identical to a wrong company, and we cannot tell them
   * apart from strings alone. Refusing guesses, and guessed wrong for a customer
   * whose paperwork was in order -- so the document is kept and the CUSTOMER is
   * asked which name is the registered one.
   */
  severity: "block" | "confirm";
  reason: string;
}

/**
 * A reason to doubt the document, or null.
 *
 * Only ever objects on evidence: a field absent from either side is not a
 * mismatch, and the first document of an application has nothing to contradict.
 */
export function entityMismatch(
  existing: Record<string, unknown>,
  extracted: Record<string, unknown>
): EntityConflict | null {
  // Exact identifiers first. A match settles the names in ITS OWN category and no
  // further: a matching passport number says nothing about which company the
  // document belongs to, and an early return on it hid a genuine company
  // mismatch until the test below caught it.
  const settled = { company: false, person: false };
  for (const f of ID_FIELDS) {
    const before = existing[f.key];
    const after = extracted[f.key];
    if (typeof before !== "string" || typeof after !== "string") continue;
    const a = normaliseId(before);
    const b = normaliseId(after);
    if (!a || !b) continue;
    if (a === b) { settled[f.settles] = true; continue; }
    return {
      severity: "block",
      reason:
        `This document's ${f.label} (${after}) does not match the one already on this application (${before}). ` +
        `Please upload the document for the same company, or correct the details first.`,
    };
  }

  // The owner's own name, across the licence, the Emirates ID and the passport.
  const knownPerson = settled.person ? [] : pick(existing, PERSON_NAME_FIELDS);
  const foundPerson = pick(extracted, PERSON_NAME_FIELDS);
  if (knownPerson.length && foundPerson.length && !foundPerson.some((f) => knownPerson.some((k) => nameMatches(k, f)))) {
    return {
      severity: "confirm",
      reason:
        `This document names the owner as "${raw(extracted, PERSON_NAME_FIELDS)}", and the application says ` +
        `"${raw(existing, PERSON_NAME_FIELDS)}". Names are transliterated differently on different documents, so ` +
        `ask the customer to confirm these are the same person before continuing rather than telling them the ` +
        `document is wrong.`,
    };
  }

  for (const f of settled.person ? [] : PERSON_SOFT_FIELDS) {
    const before = existing[f.key];
    const after = extracted[f.key];
    if (typeof before !== "string" || typeof after !== "string") continue;
    const a = normaliseName(before);
    const b = normaliseName(after);
    if (!a || !b || nameMatches(a, b)) continue;
    return {
      severity: "confirm",
      reason:
        `This document gives the ${f.label} as "${after}", and the application says "${before}". ` +
        `Ask the customer which is correct before continuing.`,
    };
  }

  // Names, compared as SETS. A legal name on the MOA and a trade name on the
  // licence are both this company's names, and either may appear in either slot.
  const known = settled.company ? [] : names(existing);
  const found = names(extracted);
  if (!known.length || !found.length) return null;
  if (found.some((f) => known.some((k) => nameMatches(k, f)))) return null;

  const shown =
    NAME_FIELDS.map((k) => extracted[k]).find((v): v is string => typeof v === "string" && v.trim().length > 1) ?? "";
  const against =
    NAME_FIELDS.map((k) => existing[k]).find((v): v is string => typeof v === "string" && v.trim().length > 1) ?? "";
  return {
    severity: "confirm",
    reason:
      `This document names "${shown}", and the application says "${against}". ` +
      `A company's registered name and its trade name are often different, so this may well be the right document — ` +
      `ask the customer which is the registered company name before continuing, and do not tell them the document is wrong.`,
  };
}

/**
 * Parse a date off a document.
 *
 * UAE paperwork prints DD/MM/YYYY, so an ambiguous 03/09/2026 is 3 September.
 * ISO is accepted because that is what the extraction model usually returns.
 * Anything else yields null and is treated as "not stated" rather than guessed:
 * reading a date wrong here either blocks a valid licence or passes an expired
 * one, and both are worse than not checking.
 */
export function parseDocumentDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return utc(+iso[1]!, +iso[2]!, +iso[3]!);

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (dmy) {
    const [d, m, y] = [+dmy[1]!, +dmy[2]!, +dmy[3]!];
    // A "month" above 12 means the document is MM/DD after all.
    if (m > 12 && d <= 12) return utc(y, d, m);
    return utc(y, m, d);
  }
  return null;
}

function utc(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

/** Fields that carry the trade licence's own expiry, in the order we trust them. */
const LICENCE_EXPIRY_FIELDS = ["trade_license_expiry", "license_expiry_date", "trade_license_expiry_date"] as const;

/**
 * Is the trade licence this document describes already expired?
 *
 * The client's rule: an expired licence stops the application, and a valid one
 * is requested instead. Checked on the DOCUMENT rather than trusted from the
 * conversation, because the licence copy is the evidence.
 *
 * Compared date-only in UTC+4: a licence expiring today is valid today, and
 * comparing against a UTC timestamp would expire it four hours early.
 */
export function expiredLicence(
  extracted: Record<string, unknown>,
  now = new Date()
): { expiredOn: Date; field: string } | null {
  for (const key of LICENCE_EXPIRY_FIELDS) {
    const parsed = parseDocumentDate(extracted[key]);
    if (!parsed) continue;
    const today = startOfDayGulf(now);
    if (parsed.getTime() < today.getTime()) return { expiredOn: parsed, field: key };
    return null; // a valid date settles it; do not keep looking for a worse one
  }
  return null;
}

/** Midnight in UTC+4, expressed as the UTC instant of that Gulf calendar day. */
function startOfDayGulf(now: Date): Date {
  const gulf = new Date(now.getTime() + 4 * 3_600_000);
  return new Date(Date.UTC(gulf.getUTCFullYear(), gulf.getUTCMonth(), gulf.getUTCDate()));
}

export function formatGulfDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
