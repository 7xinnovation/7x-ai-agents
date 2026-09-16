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
 * The names below are no longer inferred from what their org happens to hold.
 * On 16 September EPGL sent the ACTIVE CHECKLIST NAMES, in answer to section 4
 * of the LR-37377 payload note:
 *
 *   "below are the active checklist documents names that you can match on them
 *    to avoid overriding existing documents, like for passport we have 3
 *    passport document names: Passport, Passport copy-Partner and Passport (Of
 *    All Branch Partners)"
 *
 * Two of ours moved as a result. `trade_license` was "TRADE LICENSE" — the
 * most-used spelling in their PreProd data, counted 482 times — and their
 * checklist calls it "Trade License". The partner slots were "PASSPORT — Faisal
 * Eissa" and are now "Passport copy-Partner", which is the checklist entry that
 * was sitting empty while the file hung off a slot nobody was watching. Their
 * spellings are copied exactly, typos included: "Trail Balance for the License
 * Period" and "Memorandom Of Association-Partner" are theirs.
 *
 * WHAT THEIR LIST STILL DOES NOT SETTLE is the same thing section 4 asked:
 * three partners, one checklist name. The label is the deduplication key, so
 * three passports sent as "Passport copy-Partner" would leave partner 3's file
 * standing where partner 1's was, and the application would arrive with one
 * passport and no sign the other two were ever sent — LR-37214's complaint made
 * permanent.
 *
 * So the FIRST partner holding a given document takes the checklist name
 * exactly, which fills the required-document slot, and every partner after that
 * carries their own name beside it. First is by partner number across the whole
 * case rather than per batch: documents are pushed over several turns, and a
 * slot that changed its name between turns would upload twice.
 *
 * Asked back to EPGL on 16 September: if they would rather have one record per
 * partner, a per-partner slot on their checklist is the clean answer and we
 * will send whatever they name them.
 */

/** Slots that exist once per application: their name, exactly as they spell it. */
const SLOT: Record<string, string> = {
  trade_license: "Trade License",
  initial_approval: "Initial Approval From Economic Department",
  updated_trade_license: "Updated Trade License",
  postal_license: "Postal License",
  moa: "Memorandum of Association",
  lease_contract: "Lease Contract",
  passport: "Passport",
  emirates_id: "Emirates Id",
  audited_financial_statement: "Last Fiscal Year Audited Financial Statement",
  acknowledgement_letter: "Acknowledgement Letter for Submitting the Financial Statement",
  financial_statement: "Trail Balance for the License Period",
  form_9: "Form 9 for each quarter",
  commitment_form: "Initial Commitment Form",
  noc_letter: "NOC Letter",
  payment_receipt: "Payment Receipt",
  trade_name_reservation: "Reservation of Trade Name",
  family_book: "Copy Of Family Book",
  newspaper_report: "Newspaper Report",
  cancellation_letter: "Official Letter of Cancellation",
  other_document: "Other Document",
};

/** Slots collected once per partner. Their checklist name for the repeat. */
const PER_PARTNER: { match: RegExp; name: string }[] = [
  { match: /^partner_(\d+)_passport$/i, name: "Passport copy-Partner" },
  { match: /^partner_(\d+)_emirates_id$/i, name: "Emirates ID-Partner" },
  { match: /^partner_(\d+)_trade_license$/i, name: "Trade License-Partner" },
  // Their spelling, not ours.
  { match: /^partner_(\d+)_moa$/i, name: "Memorandom Of Association-Partner" },
];

/** Slots that describe every partner or branch at once, not one of them. */
const ALL_BRANCHES: Record<string, string> = {
  branch_partners_passport: "Passport (Of All Branch Partners)",
  branch_partners_emirates_id: "Emirates Id (Of All Branch Partners)",
  branch_trade_license: "Trade License (Of All Branches)",
  branch_moa: "Memorandum of Association (Of All Branches)",
};

interface LabelOpts {
  /** The journey's own label for a key this table has never heard of. */
  fallback?: (key: string) => string | undefined;
  /** The partner's name off the trade licence, for the second one onward. */
  partnerName?: (n: number) => string | undefined;
}

function perPartner(key: string): { name: string; n: number; kind: string } | null {
  for (const p of PER_PARTNER) {
    const m = p.match.exec(key);
    if (m) return { name: p.name, n: Number(m[1]), kind: p.name };
  }
  return null;
}

/**
 * `label__c` for every document on a case, decided together.
 *
 * Together because the repeating slots can only be named correctly in the
 * knowledge of which other partners hold the same document: the first takes the
 * checklist name, the rest take their own.
 */
export function epglDocumentLabels(keys: string[], opts: LabelOpts = {}): Map<string, string> {
  const out = new Map<string, string>();
  // Lowest partner number first, so "first" does not depend on upload order.
  const firstOfKind = new Map<string, number>();
  for (const key of keys) {
    const p = perPartner(key);
    if (!p) continue;
    const seen = firstOfKind.get(p.kind);
    if (seen === undefined || p.n < seen) firstOfKind.set(p.kind, p.n);
  }
  for (const key of keys) {
    const fixed = SLOT[key] ?? ALL_BRANCHES[key];
    if (fixed) {
      out.set(key, fixed);
      continue;
    }
    const p = perPartner(key);
    if (p) {
      const who = opts.partnerName?.(p.n)?.trim();
      out.set(key, firstOfKind.get(p.kind) === p.n ? p.name : `${p.name} - ${who || `Partner ${p.n}`}`);
      continue;
    }
    out.set(key, opts.fallback?.(key)?.trim() || key.replace(/_/g, " "));
  }
  return out;
}

/**
 * `label__c` for one document, where nothing else on the case is in view.
 *
 * A lone partner document takes the checklist name: one passport cannot collide
 * with a second that was never sent. Prefer epglDocumentLabels wherever the case
 * is to hand.
 */
export function epglDocumentLabel(
  key: string,
  opts: { fallback?: string; partnerName?: (n: number) => string | undefined } = {}
): string {
  return (
    epglDocumentLabels([key], { fallback: () => opts.fallback, partnerName: opts.partnerName }).get(key) ?? key
  );
}
