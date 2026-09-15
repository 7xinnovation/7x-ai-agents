/**
 * What to call each file on EPGL's side.
 *
 * Their contract 2.0.0 made `label__c` the thing that matters on an upload:
 *
 *   "EPG_Document__c.Name is the document slot and is taken from label__c...
 *    A second call with the same label__c under the same parent UPDATES the
 *    existing document... Send label__c matching the document checklist name
 *    ('Trade License', 'Lease Contract', 'Memorandum of Association', ...) so
 *    the upload is tied to the correct required-document slot; if it is
 *    omitted, each call with a different file name creates a separate document
 *    record."
 *
 * TWO THINGS TO GET RIGHT, AND THEY PULL AGAINST EACH OTHER.
 *
 * The first is the checklist match, which wants the name their org already
 * uses. The names below are not guesses: they are the most-used values of
 * EPG_Document__c.Name in their PreProd org, counted on 15 September — "TRADE
 * LICENSE" 482 times, "Memorandum of Association" 682, "Last Fiscal Year
 * Audited Financial Statement" 222. Sending our own label instead ("Audited
 * Financial Statements (AFS)") would match nothing and file the document under
 * a slot nobody's checklist is watching.
 *
 * The second is that the label is the DEDUPLICATION KEY. Their portal has one
 * "PASSPORT" slot; we collect one per partner. Sending all three under
 * "PASSPORT" would have partner 2's file replace partner 1's and partner 3's
 * replace partner 2's, and the application would arrive with one passport and
 * no sign that two more were ever sent. That is LR-37214's complaint — "nothing
 * on the record distinguishes partner 3's passport" — made permanent.
 *
 * So a slot that occurs once per application gets their exact name, and a slot
 * that repeats gets their name plus WHOSE it is. The partner's name if the
 * licence gave us one, the partner number otherwise, which also reads better on
 * their screen than three identical rows would.
 */

/** Slots that exist once per application: their name, exactly as their org spells it. */
const SLOT: Record<string, string> = {
  trade_license: "TRADE LICENSE",
  initial_approval: "Initial Approval From Economic Department",
  updated_trade_license: "Updated Trade License",
  postal_license: "Postal License",
  moa: "Memorandum of Association",
  lease_contract: "Lease Contract",
  emirates_id: "Emirates ID",
  audited_financial_statement: "Last Fiscal Year Audited Financial Statement",
  acknowledgement_letter: "Acknowledgement Letter for Submitting the Financial Statement",
  financial_statement: "Trail Balance for the License Period",
  form_9: "Trial Balance Sheet",
  commitment_form: "Signed Commitment Form",
};

/** Slots we collect once per partner. Their base name, then whose it is. */
const PER_PARTNER: { match: RegExp; name: string }[] = [
  { match: /^partner_(\d+)_passport$/i, name: "PASSPORT" },
  { match: /^partner_(\d+)_emirates_id$/i, name: "Emirates ID" },
];

/**
 * `label__c` for one uploaded document.
 *
 * `fallback` is the journey's own label, used for a key this table has never
 * heard of — a new document added to a journey should file under something
 * readable rather than under a file name, even before anyone maps it.
 */
export function epglDocumentLabel(
  key: string,
  opts: { fallback?: string; partnerName?: (n: number) => string | undefined } = {}
): string {
  const fixed = SLOT[key];
  if (fixed) return fixed;
  for (const p of PER_PARTNER) {
    const m = p.match.exec(key);
    if (!m) continue;
    const n = Number(m[1]);
    const who = opts.partnerName?.(n)?.trim();
    return `${p.name} — ${who || `Partner ${n}`}`;
  }
  return opts.fallback?.trim() || key.replace(/_/g, " ");
}
