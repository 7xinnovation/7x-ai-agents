/**
 * The names Salesforce actually has, applied to the composite before it is sent.
 *
 * Every field in an EPGL composite is chosen by the MODEL: the submit tool takes
 * a free-form `body`, and the only thing telling it what to call anything is
 * prose in the journey's apiFlow notes. That is how LR-37214 went out with
 * `EPG_Account__c` on a partner, `serviceId` without its `__c`, and a Members
 * row carrying two fields that do not exist on the object.
 *
 * Salesforce's review of that submission (Fuad Alnsour, 8 Sep 2026) named each
 * one. None of them is a judgement call, so none of them is left to a prompt:
 * the notes were corrected too, but this runs afterwards and does not depend on
 * the model having read them.
 *
 * The renames are scoped PER OBJECT, which matters more than it looks:
 * `EPG_Emirates_Id__c` is wrong on EPG_Partner__c and right on User, and the
 * two differ only by the capital D. Their update-matching keys off the partner
 * spelling, so the wrong casing does not fail — it silently creates a second
 * partner on every resubmission.
 */

/** The only activity codes EPGL accepts, and what a person calls them. */
export const POSTAL_ACTIVITIES: { code: string; en: string; match: RegExp }[] = [
  { code: "5320002", en: "Letters & Post Items Delivery", match: /letter|post item|postal item|mail\b|رسائل|بريدية/i },
  { code: "5320007", en: "Documents Delivery", match: /document|مستند|وثائق|وثيقة/i },
  { code: "5320009", en: "Parcels Delivery", match: /parcel|package|طرود|طرد/i },
];

/**
 * The numeric codes behind whatever the case holds, comma-separated.
 *
 * `Activity_Codes__c` is what sets the activity flags on the licence, and it
 * takes numbers. We were sending the company's DED trade-licence activities as
 * free text — LR-37214 carried "Coffee Shop, Restaurant" — which matches
 * nothing and leaves every flag unset.
 *
 * Returns null when nothing recognisable is there. An omitted field and an
 * unmatched one leave the same flags unset, but the omission does not put a
 * coffee shop on a postal licence.
 */
export function postalActivityCodes(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const codes = new Set<string>();
  // A code the customer (or a previous run) already gave us numerically.
  for (const m of text.matchAll(/\b(53200\d{2})\b/g)) {
    if (POSTAL_ACTIVITIES.some((a) => a.code === m[1])) codes.add(m[1]!);
  }
  // Otherwise read it the way it was said. Each clause is matched on its own so
  // "letters and parcels" cannot be swallowed by whichever pattern runs first.
  if (!codes.size) {
    for (const clause of text.split(/[,;/&]|\band\b|\bو\b/i)) {
      for (const a of POSTAL_ACTIVITIES) if (a.match.test(clause)) codes.add(a.code);
    }
  }
  if (!codes.size) return null;
  // Stable order, so the same answer produces the same string every time.
  return POSTAL_ACTIVITIES.filter((a) => codes.has(a.code)).map((a) => a.code).join(",");
}

/** Which sobject a composite item is for, from its url. */
function objectOf(url: unknown): string {
  return /\/sobjects\/([A-Za-z0-9_]+)\s*$/.exec(String(url ?? ""))?.[1] ?? "";
}

interface Rules {
  /** old name -> new name. An existing value under the new name always wins. */
  rename?: Record<string, string>;
  /** Fields the object does not have. */
  drop?: string[];
  /** Values Salesforce requires that nobody would think to ask a customer for. */
  defaults?: Record<string, unknown>;
}

/**
 * Per-object corrections, exactly as Salesforce listed them.
 *
 * EPG_Payment_Reference__c and EPG_Contact__c on the licence request are NOT
 * dropped here: they asked whether we need them persisted, and until that is
 * answered dropping them would throw away the only link from a licence request
 * back to the payment that settled it. They are inert on their side, not
 * harmful — the submission that carried both returned success on every item.
 */
const RULES: Record<string, Rules> = {
  EPG_Partner__c: {
    rename: {
      EPG_Account__c: "EPG_Company__c",
      // Casing is load-bearing: their update-matching reads EPG_Emirates_ID__c.
      EPG_Emirates_Id__c: "EPG_Emirates_ID__c",
    },
  },
  Members__c: {
    rename: { EPG_Account__c: "AccountId__c" },
    drop: ["EPG_Contact__c", "EPG_Designation__c"],
  },
  /**
   * "Either of Is Primary Contact or  Is Secondary Contact should be selected."
   *
   * A Salesforce validation rule on Contact that rejected every EPGL submission
   * on 9 September. allOrNone echoes the message onto all nine items, so the
   * model read it as an Account problem, tried the flag there, tried again, and
   * finally offered a callback for an application that was complete.
   *
   * Two spec errors and one design error sat behind it, and only the third one
   * mattered.
   *
   * The spec errors: their swagger called the field `Secondary_Contact`; the
   * real name is `Is_Secondary_Contact__c` (corrected in their 9 Sep swagger),
   * a STRING enum of 'True' | 'False' rather than a boolean. And the two fields
   * the rule reads are read-only to our integration user, so guessing at them
   * was never going to work anyway.
   *
   * The design error is ours, and it is the one that broke the submission.
   * Their two Contact-shaped objects are not interchangeable:
   *
   *   NewUser     the portal applicant. Their handler creates a Contact for
   *               this person and marks it PRIMARY.
   *   NewContact  "Secondary contacts" -- the company's other contact person.
   *               Their handler marks it SECONDARY.
   *
   * We were sending the applicant's own email as NewContact. Their handler
   * matches Contact on Email, found the Primary contact a previous submission
   * had already created for that same person, and tried to mark it Secondary
   * too. One person cannot be both, so the rule fired -- correctly.
   *
   * So we no longer state the designation at all (their handler owns it, and we
   * could not write it if we wanted to), and a NewContact that names the same
   * person as NewUser is dropped rather than sent: one applicant needs one
   * record, and their handler already makes it Primary.
   */
  Contact: {
    drop: ["Secondary_Contact", "Is_Primary_Contact__c"],
    defaults: { Is_Secondary_Contact__c: "True" },
  },
  EPG_License_Request__c: {
    rename: {
      serviceId: "serviceId__c",
      // Capital S. Their review and their swagger both say serviceNameEN__c; a
      // describe of the object says the field is ServiceNameEN__c. Salesforce
      // resolves field names case-insensitively on write, so the lower-case form
      // has been landing correctly all along — but there is no reason to send a
      // name the org does not use, and the next person to compare payload
      // against schema should not have to work this out again.
      serviceNameEN: "ServiceNameEN__c",
      serviceNameEN__c: "ServiceNameEN__c",
      serviceNameAR: "ServiceNameAR__c",
      serviceNameAR__c: "ServiceNameAR__c",
      EPG_Activity_Codes__c: "Activity_Codes__c",
      Terms_Conditions_Accepted__c: "EPG_Terms_and_Conditions__c",
      EPG_Emirates__c: "EPG_Current_Emirate__c",
      EPG_Region__c: "EPG_Current_Region__c",
    },
  },
};

function fixRow(object: string, row: Record<string, unknown>): Record<string, unknown> {
  const rules = RULES[object];
  if (!rules) return row;
  const out: Record<string, unknown> = { ...row };
  for (const [from, to] of Object.entries(rules.rename ?? {})) {
    if (!(from in out)) continue;
    const value = out[from];
    delete out[from];
    // Whatever already sits under the correct name is the one that stays.
    if (out[to] === undefined || out[to] === null || out[to] === "") out[to] = value;
  }
  for (const key of rules.drop ?? []) delete out[key];
  for (const [key, value] of Object.entries(rules.defaults ?? {})) {
    if (out[key] === undefined || out[key] === null || out[key] === "") out[key] = value;
  }
  // Their enum is the STRINGS 'True' and 'False', not booleans -- an unexpected
  // type is one more way to fail a whole allOrNone composite.
  if (object === "Contact" && out.Is_Secondary_Contact__c !== undefined) {
    const v = out.Is_Secondary_Contact__c;
    out.Is_Secondary_Contact__c = v === false || /^(false|no|0)$/i.test(String(v)) ? "False" : "True";
  }
  if (object === "EPG_License_Request__c" && out.Activity_Codes__c !== undefined) {
    const codes = postalActivityCodes(out.Activity_Codes__c);
    if (codes) out.Activity_Codes__c = codes;
    else delete out.Activity_Codes__c;
  }
  return out;
}

/** Every email the composite claims for the portal applicant. */
function applicantEmails(items: Record<string, unknown>[]): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    if (objectOf(item?.url) !== "User") continue;
    const rows = Array.isArray(item.body) ? item.body : [item.body];
    for (const row of rows as Record<string, unknown>[]) {
      const email = String(row?.Email ?? "").trim().toLowerCase();
      if (email) out.add(email);
    }
  }
  return out;
}

/**
 * A member with no name is not a member.
 *
 * Salesforce matches Members__c on Name and, without one, files the row as
 * "Unknown Member" — so a nameless row is not a record with a gap in it, it is
 * a placeholder that will also collide with every other nameless row.
 */
function keepRow(object: string, row: Record<string, unknown>, applicants: Set<string>): boolean {
  // The applicant is not their own secondary contact. Their handler creates a
  // PRIMARY Contact from NewUser and matches Contact on Email, so a NewContact
  // carrying the applicant's email is an update of that same record trying to
  // mark it Secondary as well -- which is exactly the validation rule that
  // rejected every submission on 9 September. Sending nothing is right, not a
  // workaround: the record their handler makes from NewUser is the one wanted.
  if (object === "Contact") {
    const email = String(row.Email ?? "").trim().toLowerCase();
    return !(email && applicants.has(email));
  }
  if (object !== "Members__c") return true;
  return String(row.Name ?? "").trim().length > 0;
}

/** Apply every correction to a composite submit payload. Shape is preserved. */
export function withEpglFieldNames(
  input: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
  if (!Array.isArray(body.compositeRequest)) return input;
  const all = body.compositeRequest as Record<string, unknown>[];
  const applicants = applicantEmails(all);
  const items = all.map((item) => {
    const object = objectOf(item?.url);
    if (!object || !item) return item;
    const keep = (r: Record<string, unknown>) => keepRow(object, r, applicants);
    if (Array.isArray(item.body)) {
      const rows = (item.body as Record<string, unknown>[])
        .filter((r) => r && typeof r === "object" && keep(r))
        .map((r) => fixRow(object, r));
      return { ...item, body: rows };
    }
    if (item.body && typeof item.body === "object") {
      const row = item.body as Record<string, unknown>;
      if (!keep(row)) return null;
      return { ...item, body: fixRow(object, row) };
    }
    return item;
  });
  // An item whose only row was dropped goes with it; an empty array-bodied item
  // would fail the whole allOrNone composite.
  const kept = items.filter(
    (i): i is Record<string, unknown> => i !== null && !(Array.isArray(i.body) && i.body.length === 0)
  );
  body.compositeRequest = kept;
  return { ...input, body };
}
