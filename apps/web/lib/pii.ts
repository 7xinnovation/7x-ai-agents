/**
 * Guest-mode PII redaction for integration tool results (PRD: data privacy).
 *
 * Backend lookups that work key-only (e.g. NXN guest renewal Details) can return
 * personal data about the record's owner — holder name, email, phone, Emirates
 * ID. An unauthenticated visitor only proves knowledge of a box number, so that
 * data must never reach the model (what the model doesn't see, it can't say).
 *
 * Values are masked, not dropped: a masked holder name still lets the agent say
 * "the box registered to M*********** A**** *****B" as a soft confirmation without
 * disclosing the identity (FB-1323 asked for exactly that pattern in the guest
 * renewal flow: the first letter of the first name, the last letter of the last
 * name, every other character starred, and the word lengths preserved).
 */

const norm = (key: string) => key.replace(/[_\s-]/g, "").toLowerCase();

// Person-name keys, always masked. A bare "name" is NOT here — it's usually a
// product/bundle/branch label; it is masked only via the sibling heuristic below.
const NAME_KEYS = new Set([
  "customername", "customerfullname", "holdername", "boxholdername", "ownername",
  "applicantname", "contactname", "personname", "displayname", "fullname",
  "firstname", "lastname", "middlename", "arabicname", "englishname",
  "namear", "nameen", "customernamear", "customernameen",
]);
const EMAIL_KEYS = new Set(["email", "emailaddress", "emailid", "customeremail"]);
const NUMBER_KEYS = new Set([
  "mobile", "mobileno", "mobilenumber", "phone", "phoneno", "phonenumber",
  "msisdn", "contactno", "contactnumber", "telephone", "emiratesid", "eid",
  "eidnumber", "idnumber", "nationalid", "passport", "passportno",
  "passportnumber", "trn", "iban", "customermobile",
]);
const DROP_KEYS = new Set(["dateofbirth", "dob", "birthdate", "homeaddress", "addressline1", "addressline2"]);

/**
 * Mask a person's name to the shape the client asked for in FB-1323:
 * "Mohammed Ali Alhabib" -> "M*********** A**** *****B". The first word keeps its
 * leading letter, the last word keeps its trailing letter, and every word keeps its
 * length so the customer can recognise their own name without it being disclosed.
 * A single-word name keeps only its first letter.
 */
export const maskName = (s: string): string => {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return s;
  return words
    .map((w, i) => {
      const stars = "*".repeat(Math.max(w.length - 1, 1));
      if (words.length > 1 && i === words.length - 1) return `${stars}${w[w.length - 1]}`;
      return `${w[0]}${stars}`;
    })
    .join(" ");
};
// Asterisks throughout, matching the masking convention the client specified.
const maskEmail = (s: string) => {
  const [local = "", domain = ""] = s.split("@");
  return `${local[0] ?? ""}***@${domain[0] ?? ""}***`;
};
const maskDigits = (s: string) => {
  const digits = s.replace(/\D/g, "");
  return digits.length > 3 ? "*".repeat(digits.length - 3) + digits.slice(-3) : "***";
};

/** Does this object carry contact/identity fields (so its `name` is a person)? */
const looksLikePerson = (obj: Record<string, unknown>) =>
  Object.keys(obj).some((k) => {
    const n = norm(k);
    return EMAIL_KEYS.has(n) || NUMBER_KEYS.has(n) || NAME_KEYS.has(n);
  });

function redactString(normKey: string, value: string, personContext: boolean): string {
  if (EMAIL_KEYS.has(normKey)) return maskEmail(value);
  if (NUMBER_KEYS.has(normKey)) return maskDigits(value);
  if (DROP_KEYS.has(normKey)) return "***";
  if (NAME_KEYS.has(normKey) || (personContext && (normKey === "name" || normKey === "title"))) return maskName(value);
  return value;
}

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const person = looksLikePerson(obj);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = typeof v === "string" ? redactString(norm(k), v, person) : walk(v);
    }
    return out;
  }
  return node;
}

/**
 * Redact PII from a raw integration response body. Tries JSON first; on parse
 * failure returns the input unchanged (a non-JSON body is typically an error
 * page, which carries no customer data).
 */
export function redactGuestPII(bodyText: string): string {
  if (!bodyText) return bodyText;
  try {
    return JSON.stringify(walk(JSON.parse(bodyText)));
  } catch {
    return bodyText;
  }
}
