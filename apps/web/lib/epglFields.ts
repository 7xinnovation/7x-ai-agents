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
   * Their swagger says the field is `Secondary_Contact`, an enum of 'True' |
   * 'False'. I sent that, and the rule still fired. A describe against their own
   * sandbox says why: Secondary_Contact DOES NOT EXIST on Contact. The two
   * fields the rule actually reads are booleans —
   *
   *   Is_Primary_Contact__c     "Is Primary Contact"
   *   Is_Secondary_Contact__c   "Is Secondary Contact"
   *
   * — and neither is in the published spec. The error names the labels, which is
   * why guessing from it did not work twice.
   *
   * The contact we send is the person the applicant nominated to be contacted
   * about this licence, which is the primary one; they need not be named on the
   * trade licence at all. So primary is the default, set only when the
   * submission has not already said otherwise — a genuinely secondary contact
   * marked as such stays that way.
   *
   * IT DOES NOT WORK YET, AND CANNOT FROM HERE. The same describe reports both
   * flags as createable:false, updateable:false — our integration user cannot
   * write either of them, so a rule demanding one of them be true can never be
   * satisfied by an API-created Contact. EPG_Designation__c is read-only to us
   * for the same reason. Sending the value anyway is deliberate and harmless:
   * Salesforce ignores a field the caller cannot write, and the day EPGL grant
   * field-level access the payload is already correct. Until then every
   * agent-sourced EPGL submission fails on this rule, and it is theirs to fix.
   */
  Contact: {
    drop: ["Secondary_Contact"],
    defaults: { Is_Primary_Contact__c: true },
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
  // One designation, not both. A contact explicitly marked secondary is not also
  // the primary one, and the rule is satisfied either way.
  if (object === "Contact" && out.Is_Secondary_Contact__c === true) delete out.Is_Primary_Contact__c;
  if (object === "EPG_License_Request__c" && out.Activity_Codes__c !== undefined) {
    const codes = postalActivityCodes(out.Activity_Codes__c);
    if (codes) out.Activity_Codes__c = codes;
    else delete out.Activity_Codes__c;
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
function keepRow(object: string, row: Record<string, unknown>): boolean {
  if (object !== "Members__c") return true;
  return String(row.Name ?? "").trim().length > 0;
}

/** Apply every correction to a composite submit payload. Shape is preserved. */
export function withEpglFieldNames(
  input: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
  if (!Array.isArray(body.compositeRequest)) return input;
  const items = (body.compositeRequest as Record<string, unknown>[]).map((item) => {
    const object = objectOf(item?.url);
    if (!object || !item) return item;
    if (Array.isArray(item.body)) {
      const rows = (item.body as Record<string, unknown>[])
        .filter((r) => r && typeof r === "object" && keepRow(object, r))
        .map((r) => fixRow(object, r));
      return { ...item, body: rows };
    }
    if (item.body && typeof item.body === "object") {
      const row = item.body as Record<string, unknown>;
      if (!keepRow(object, row)) return null;
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
