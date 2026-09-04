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

/** Every readable value, as PRINTED -- person matching needs the spaces. */
function rawAll(source: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields
    .map((k) => source[k])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 1);
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

/**
 * The same PERSON, written two different ways.
 *
 * Substring containment is right for a company and wrong for a person. An MOA
 * abbreviates where a passport does not, and the parts are not a prefix of each
 * other: "Abdelaziz Mohamed Obaid" on the shareholder table is "Mohamed
 * Abdelaziz Mohamed Balhaif Alnuaimi" on his Emirates ID. Neither contains the
 * other, so a containment test calls one man two people -- which is what it did.
 *
 * Compared as name PARTS instead: the same person if most of the shorter name's
 * parts appear in the longer one. Two parts minimum, because "Mohamed" alone is
 * shared by half the country and one part in common is not evidence of anything.
 */
function personMatches(a: string, b: string): boolean {
  // Split on punctuation as well as spaces: "Al-Mansoori" is two parts, and
  // treating it as one made a hyphen enough to turn a man into a stranger.
  const partsOf = (s: string) =>
    s.split(/[\s\-_.,'\u2019]+/).map((p) => normaliseName(p)).filter((p) => p.length > 1);
  const A = partsOf(a);
  const B = partsOf(b);
  if (!A.length || !B.length) return false;
  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  const set = new Set(long);
  const shared = short.filter((p) => set.has(p)).length;
  if (shared === short.length) return true;                 // every part accounted for
  return shared >= 2 && shared / short.length >= 0.5;       // most of it, and not by one common part
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
/**
 * A document slot belonging to somebody other than the owner.
 *
 * Partner 2's passport carries partner 2's name, number and nationality, and
 * comparing those against the OWNER's would block the application on every
 * partner after the first -- the person checks below are about one person's
 * documents agreeing with each other, not about two different people.
 */
function isOtherPersonSlot(documentKey: string | undefined): boolean {
  return !!documentKey && /^(partner|shareholder|agent)_\d+_/i.test(documentKey);
}

export function entityMismatch(
  existing: Record<string, unknown>,
  extracted: Record<string, unknown>,
  opts: { documentKey?: string } = {}
): EntityConflict | null {
  // Exact identifiers first. A match settles the names in ITS OWN category and no
  // further: a matching passport number says nothing about which company the
  // document belongs to, and an early return on it hid a genuine company
  // mismatch until the test below caught it.
  // A partner's own documents are checked against each other elsewhere, never
  // against the owner's.
  const otherPerson = isOtherPersonSlot(opts.documentKey);
  const settled = { company: false, person: otherPerson };
  for (const f of ID_FIELDS) {
    if (otherPerson && f.settles === "person") continue;
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
  const knownPerson = settled.person ? [] : rawAll(existing, PERSON_NAME_FIELDS);
  const foundPerson = rawAll(extracted, PERSON_NAME_FIELDS);
  if (knownPerson.length && foundPerson.length && !foundPerson.some((f) => knownPerson.some((k) => personMatches(k, f)))) {
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

/* ------------------------------------------------------------------------- *
 * Partner documents, cross-checked BY NAME.
 *
 * A partner's passport and Emirates ID must be the same person's, and which
 * partner a document belongs to is decided by the NAME printed on it -- not by
 * which slot the customer happened to drop it into. Uploading four partners'
 * papers is exactly the task people misfile, and a set that is complete but
 * shuffled is worse than one that is visibly short: every slot shows a green
 * tick and partner 3 has partner 1's passport against their name.
 *
 * Names are compared, so nothing here BLOCKS -- transliteration varies between a
 * passport and an Emirates ID for the same person, and the customer is the one
 * who can settle it.
 * ------------------------------------------------------------------------- */

/** The names seen on documents so far, keyed by partner slot. Bookkeeping. */
export const PARTNER_NAMES_KEY = "__partner_names";

/** `partner_2_passport` -> { index: 2, kind: "passport" }. */
export function partnerSlot(documentKey: string): { index: number; kind: string } | null {
  const m = /^partner_(\d+)_(.+)$/i.exec(documentKey);
  if (!m) return null;
  const index = Number(m[1]);
  return Number.isInteger(index) && index > 0 ? { index, kind: m[2]!.toLowerCase() } : null;
}

/** The person's name this document carries, however the extraction labelled it. */
function personName(extracted: Record<string, unknown>): string | null {
  return raw(extracted, [...PERSON_NAME_FIELDS, "full_name", "name"]) || null;
}

/** The name already on file for a partner: an explicit field, or a group row. */
function knownPartnerName(data: Record<string, unknown>, index: number): string | null {
  const direct = raw(data, [`partner_${index}_name`, `partner_${index}_name_en`, `partner_${index}_name_ar`]);
  if (direct) return direct;
  const group = data.partners ?? data.shareholders;
  if (Array.isArray(group)) {
    const row = group[index - 1];
    if (row && typeof row === "object") {
      return raw(row as Record<string, unknown>, ["name", "name_en", "name_ar", "full_name", "partner_name"]) || null;
    }
  }
  return null;
}

/** Names already observed on this partner's other documents. */
function seenPartnerName(data: Record<string, unknown>, index: number): string | null {
  const seen = data[PARTNER_NAMES_KEY];
  if (!seen || typeof seen !== "object") return null;
  const v = (seen as Record<string, unknown>)[String(index)];
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Which partner is this person, by name?
 *
 * The owner is usually also one of the partners, and their Emirates ID is one
 * card. Asked for it as "the owner's", then again as "Partner 1's", the customer
 * uploads the same file twice and is right to find that stupid.
 */
export function partnerIndexByName(data: Record<string, unknown>, name: string, max = 12): number | null {
  if (!name.trim()) return null;
  for (let i = 1; i <= max; i++) {
    const known = knownPartnerName(data, i) ?? seenPartnerName(data, i);
    if (known && personMatches(known, name)) return i;
  }
  return null;
}

export interface PartnerCheck {
  conflict: EntityConflict | null;
  /** The name to record against this slot, so the next document can be matched. */
  observedName: string | null;
}

/**
 * Check a partner document against the name it should carry.
 *
 * Three questions, in the order that gives the most useful answer:
 *   1. Does it match the name the LICENCE gives for this partner?
 *   2. Does it match this partner's OTHER document, when no licence name exists?
 *   3. Does it match a DIFFERENT partner? -- the misfiling case, and the one
 *      worth naming precisely, because "wrong name" sends the customer looking
 *      for a problem with the document rather than with the slot.
 */
export function partnerDocumentCheck(
  documentKey: string,
  data: Record<string, unknown>,
  extracted: Record<string, unknown>
): PartnerCheck {
  const slot = partnerSlot(documentKey);
  const found = personName(extracted);
  if (!slot || !found) return { conflict: null, observedName: found };

  if (!normaliseName(found)) return { conflict: null, observedName: found };

  // Whose slot did this land in, and does the name agree? Compared as name PARTS
  // -- an MOA abbreviates where a passport does not, and neither contains the
  // other.
  const expected = knownPartnerName(data, slot.index) ?? seenPartnerName(data, slot.index);
  if (expected && personMatches(expected, found)) {
    return { conflict: null, observedName: found };
  }

  // Does it belong to one of the OTHER partners? Checked before reporting a
  // plain mismatch: "this is partner 1's passport" is actionable, "this name
  // does not match" sends them hunting through the document.
  for (let i = 1; i <= 12; i++) {
    if (i === slot.index) continue;
    const other = knownPartnerName(data, i) ?? seenPartnerName(data, i);
    if (other && personMatches(other, found)) {
      // BLOCK, not ask. This is not a transliteration question: the name on the
      // document positively matches a DIFFERENT person named on this same
      // application, so we know exactly whose it is and it is not this
      // partner's. Accepting it -- which is what "confirm" did -- left a green
      // tick against partner 1 with partner 3's card behind it, and the customer
      // reasonably read the tick as "done".
      return {
        observedName: found,
        conflict: {
          severity: "block",
          reason:
            `This is ${found}'s Emirates ID, and they are partner ${i} on this application — not partner ${slot.index}. ` +
            `Please upload partner ${slot.index}'s document here, and ${found}'s under partner ${i}.`,
        },
      };
    }
  }

  if (!expected) return { conflict: null, observedName: found };

  return {
    observedName: found,
    conflict: {
      severity: "confirm",
      reason:
        `Partner ${slot.index} is recorded as "${expected}", and this document names "${found}". ` +
        `Every partner's passport and Emirates ID must be the same person's, so ask the customer which is right ` +
        `before continuing — names are written differently on different documents, so this may simply be a ` +
        `spelling difference rather than the wrong file.`,
    },
  };
}

/* ------------------------------------------------------------------------- *
 * The OWNER's own identity documents.
 *
 * A licence names its owner and its partners. An Emirates ID uploaded into the
 * owner's slot has to be that person's -- and until now a stranger's card was
 * ACCEPTED, with a remark afterwards that the name did not seem to appear on the
 * trade licence. A remark is not a rejection: the document stayed on the case,
 * its Emirates ID number filled the owner's field, and the application carried
 * somebody else's identity into Salesforce.
 *
 * Partner documents already refuse this properly. This is the same rule for the
 * owner, and it is deliberately WIDER than "the owner": the owner is very often
 * also one of the partners, and on a multi-partner licence any of the named
 * people can legitimately be the one whose card is on file. So the card is
 * accepted when it belongs to ANY person the licence names, and refused when it
 * belongs to none of them -- which is the case worth stopping.
 * ------------------------------------------------------------------------- */

/** Everyone this application names: the owner, and every partner on file. */
export function namedPeople(data: Record<string, unknown>, max = 12): { label: string; name: string }[] {
  const out: { label: string; name: string }[] = [];
  const owner = raw(data, PERSON_NAME_FIELDS);
  if (owner) out.push({ label: "the owner", name: owner });
  for (let i = 1; i <= max; i++) {
    const n = knownPartnerName(data, i) ?? seenPartnerName(data, i);
    if (n) out.push({ label: `partner ${i}`, name: n });
  }
  return out;
}

export interface OwnerDocCheck {
  /** Refuse the upload with this reason, or null to accept. */
  reject: string | null;
  /** Which named person it turned out to be, when it matched one. */
  matched?: string;
}

/**
 * Does this identity document belong to someone this licence names?
 *
 * Silent -- accepts -- when there is nothing to check against: no name on the
 * document, or no names on file yet. The first document of an application has
 * nothing to contradict, and refusing it would stall every journey at step one.
 */
export function ownerDocumentCheck(
  data: Record<string, unknown>,
  extracted: Record<string, unknown>,
  kind: "Emirates ID" | "passport" = "Emirates ID"
): OwnerDocCheck {
  const found = raw(extracted, [...PERSON_NAME_FIELDS, "full_name", "name"]);
  if (!found) return { reject: null };
  const people = namedPeople(data);
  if (!people.length) return { reject: null };

  const hit = people.find((p) => personMatches(p.name, found));
  if (hit) return { reject: null, matched: hit.label };

  const list = people.map((p) => `${p.name} (${p.label})`).join(", ");
  return {
    reject:
      `This ${kind} is in the name of ${found}, who is not named on this licence. ` +
      `The licence names: ${list}. Please upload the ${kind} for one of them.`,
  };
}
