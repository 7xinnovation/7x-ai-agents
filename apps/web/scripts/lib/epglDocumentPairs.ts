/**
 * One slot per document, where we had two.
 *
 * The 2.0 journey has documents from two places. Our own slots — `moa`,
 * `partner_1_passport`, `partner_1_emirates_id` — are hand-named, predate 2.0,
 * and exist to read fields off a file. The `declarations` step is generated
 * from EPGL's catalogue, whose `documents[]` entries carry `key: null`, so
 * every one of those slots is slugged from the English name. Nothing
 * reconciled the two, so the same document had a card in each step: the
 * applicant was asked for their MOA twice, and the panel showed an unticked
 * row for a file already on file (LR-54066, 26 October, three such pairs).
 *
 * THE DOUBLE-ASK WAS LOAD-BEARING, which is why it was not simply deleted.
 * Only a slot carrying `salesforceType` is pushed to Salesforce — their
 * checklist refuses a type it does not know, by name — and that flag was set
 * on catalogue-generated slots and on no others. So the second card was the
 * only copy that reached EPGL at all; removing it would have left the document
 * uploaded, ticked, and never sent.
 *
 * The fix is therefore a MERGE, not a delete: the catalogue's own name, its
 * validity rule, its formats and its size limit move onto the slot the
 * applicant already fills, and the twin goes. One card, one upload, and the
 * file reaches their checklist under the name their checklist knows.
 *
 * WHAT THIS DELIBERATELY DOES NOT TOUCH:
 *
 *  - **Partners 2 to 8.** Their catalogue has ONE `Copy of Passport` for the
 *    whole application. `Document_Type` is the deduplication key on their
 *    side, exactly as `label__c` is in 1.x, so a second partner's passport
 *    sent under the same type stands where the first one's was and the
 *    application arrives holding one passport. Only partner 1 takes the
 *    catalogue slot. Partners 2–8 need a per-partner type from EPGL — the same
 *    question section 4 of the LR-37377 note asked and their 16 September
 *    answer did not settle — and until it is answered they are not sent,
 *    which is the honest outcome rather than a silent overwrite.
 *  - **The trade licence.** Ours is one unconditioned slot; the catalogue has
 *    two, `Trade Licence / Initial Name Approval` for CEP30 and `Trade Licence`
 *    for the other four products, and a slot carries one type. Merging it
 *    needs either a family-dependent type or an answer on whether one name
 *    covers both. Left alone until EPGL say.
 *  - **`requirement`.** Ours is the more careful of the two — a Sole
 *    Establishment has no MOA and a corporate partner has no passport, and
 *    the catalogue says "required" flatly. The condition stays ours.
 */

/**
 * EPGL's own name for the slot -> the key of the slot of ours that already
 * asks the applicant for that document.
 *
 * Keyed on `salesforceType` rather than on the generated slug: the slug is
 * derived from the English name and would change with their wording, while
 * the type is the value their API is actually matched on.
 */
export const MERGE_INTO: Record<string, string> = {
  "Memorandum of Association": "moa",
  "Copy of Passport": "partner_1_passport",
  "Copy of Emirates ID": "partner_1_emirates_id",
};

/** The fields a catalogue slot owns and a merged slot therefore takes from it. */
const CARRIED = ["salesforceType", "validityRequired", "acceptedFormats", "maxSizeMb"] as const;

export interface Slot {
  key: string;
  salesforceType?: string;
  validityRequired?: boolean;
  acceptedFormats?: string[];
  maxSizeMb?: number;
  [k: string]: unknown;
}
export interface Step {
  key: string;
  documents?: Slot[];
  [k: string]: unknown;
}
export interface Journey {
  key?: string;
  steps?: Step[];
  [k: string]: unknown;
}

export interface MergeReport {
  /** `<our key> <- <their type>`, one per pair that moved. */
  merged: string[];
  /** Catalogue twins removed, by the step they sat in. */
  removed: string[];
  /** A pair in the table whose own slot this journey does not have. */
  missing: string[];
  /** Same key in two steps, the untyped one dropped. */
  deduped: string[];
}

/**
 * Fold every catalogue twin into the slot it duplicates.
 *
 * Mutates `journey` and reports what moved. Idempotent: a journey already
 * merged has no twin left to find, so a second run reports nothing and changes
 * nothing. Safe to run after the journey generator, which is where it is
 * called from so that regenerating the step cannot quietly bring the twins
 * back.
 */
export function mergeDocumentSlots(journey: Journey): MergeReport {
  const report: MergeReport = { merged: [], removed: [], missing: [], deduped: [] };
  const steps = journey.steps ?? [];
  const all = (): { step: Step; doc: Slot }[] =>
    steps.flatMap((step) => (step.documents ?? []).map((doc) => ({ step, doc })));

  for (const [type, ours] of Object.entries(MERGE_INTO)) {
    // `doc.key !== ours` is what makes a second run a no-op: after the merge the
    // type sits on OUR slot, and without this it would find that slot, look for
    // a second one by the same key, fail, and report the pair as broken.
    const twin = all().find(({ doc }) => doc.salesforceType === type && doc.key !== ours);
    if (!twin) continue; // already merged, or this journey never had it
    const target = all().find(({ doc }) => doc.key === ours && doc !== twin.doc);
    if (!target) {
      // Never drop the twin in this case: it is the only slot asking for the
      // document, and deleting it would lose it from the application entirely.
      report.missing.push(`${ours} (for "${type}")`);
      continue;
    }
    for (const f of CARRIED) {
      if (twin.doc[f] !== undefined) (target.doc as Record<string, unknown>)[f] = twin.doc[f];
    }
    twin.step.documents = (twin.step.documents ?? []).filter((d) => d !== twin.doc);
    report.merged.push(`${ours} <- "${type}"`);
    report.removed.push(`${twin.step.key}.${twin.doc.key}`);
  }

  // The same key declared in two steps — `lease_contract` is ours in
  // `documents` and the catalogue's in `declarations`. Readiness matches on the
  // key, so one upload already satisfied both; what was duplicated was the row
  // the applicant sees. The typed one wins: it is the one EPGL will accept.
  const byKey = new Map<string, { step: Step; doc: Slot }[]>();
  for (const entry of all()) {
    const list = byKey.get(entry.doc.key) ?? [];
    list.push(entry);
    byKey.set(entry.doc.key, list);
  }
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const typed = list.filter((e) => e.doc.salesforceType);
    if (typed.length !== 1) continue; // none typed, or both — not ours to resolve
    for (const e of list) {
      if (e.doc.salesforceType) continue;
      e.step.documents = (e.step.documents ?? []).filter((d) => d !== e.doc);
      report.deduped.push(`${e.step.key}.${key}`);
    }
  }
  return report;
}
