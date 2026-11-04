/**
 * One file, two slots: the catalogue twin.
 *
 * The 2.0 journey asks for some documents twice. Our own slots are hand-named
 * and exist to read fields off a file; the `declarations` step is generated
 * from EPGL's catalogue and its slots carry `salesforceType`, which is the only
 * thing that makes a document reach their checklist. Three pairs were merged in
 * October (`moa`, `partner_1_passport`, `partner_1_emirates_id`). The trade
 * licence could not be: their catalogue has TWO names for it — "Trade Licence /
 * Initial Name Approval" for CEP30 and "Trade Licence" for the other four
 * products — and a slot carries one name, so the merge needed an answer from
 * EPGL that never came.
 *
 * It mattered little while the catalogue's slots were invisible to readiness.
 * On 4 November they stopped being invisible, and the applicant would have been
 * asked to upload the same trade licence twice: once for us to read, once for
 * EPGL to receive.
 *
 * So the pairing is resolved per upload instead of per configuration. A file
 * landing in one slot fills its twin, and because the twin is chosen against
 * the case's own data, CEP30 fills the initial-approval slot and the other four
 * fill the plain trade-licence slot without either being written down twice.
 *
 * WHAT IS DELIBERATELY NOT A TWIN:
 *
 *  - **Anything per-partner.** `partner_1_passport` and `partner_2_passport`
 *    take the same KIND of document and are two different documents. Mirroring
 *    between them would satisfy a slot with another person's passport, which
 *    is the failure their own `Document_Type` deduplication already causes on
 *    the Salesforce side and must not be reproduced here.
 *  - **Two slots that are both ours, or both the catalogue's.** A twin exists
 *    only to carry a file across the boundary between the two; a pair on the
 *    same side of it is two genuine documents.
 */
import { evalCondition } from "@dialog/core";
import { acceptedDocTypes } from "./documentSlots";
import { partnerSlot } from "./docIdentity";

export interface TwinSlot {
  key: string;
  label?: { en?: string; ar?: string } | string;
  salesforceType?: string;
  requirement?: string;
  condition?: string;
}

const labelOf = (s: TwinSlot): string =>
  typeof s.label === "string" ? s.label : String(s.label?.en ?? "");

/** The document families a slot will take, as the upload route gates them. */
const familiesOf = (s: TwinSlot): string[] => acceptedDocTypes(s.key, labelOf(s)) ?? [];

/**
 * The slot that should receive the same file, or null when there is no twin.
 *
 * `uploaded` is the slot the customer actually filled. The twin is a slot on
 * the OTHER side of the our-slots/catalogue-slots boundary that takes the same
 * document, applies to this application, and has nothing in it yet.
 */
export function catalogueTwinOf(
  slots: TwinSlot[],
  uploadedKey: string,
  data: Record<string, unknown>,
  filled: (key: string) => boolean
): string | null {
  const source = slots.find((s) => s.key === uploadedKey);
  if (!source) return null;
  // Per-partner documents are per-person, never twins. See the note above.
  if (partnerSlot(uploadedKey)) return null;
  const families = familiesOf(source);
  if (!families.length) return null;

  const sourceIsOurs = !source.salesforceType;
  const candidates = slots.filter((s) => {
    if (s.key === uploadedKey) return false;
    // Across the boundary only: one side carries EPGL's name, the other does
    // not. A candidate qualifies when it sits on the side the source does not.
    const candidateIsCatalogue = Boolean(s.salesforceType);
    if (candidateIsCatalogue !== sourceIsOurs) return false;
    if (partnerSlot(s.key)) return false;
    if (s.requirement === "optional") return false;
    // Only a slot this application actually needs.
    if (!evalCondition(s.condition, data)) return false;
    if (filled(s.key)) return false;
    const theirs = familiesOf(s);
    return theirs.some((f) => families.includes(f));
  });
  // One twin or none. Two would mean the catalogue has two live names for one
  // document, which is the question EPGL were asked and is not ours to guess.
  return candidates.length === 1 ? candidates[0]!.key : null;
}
