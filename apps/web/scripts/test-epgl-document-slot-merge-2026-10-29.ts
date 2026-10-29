/**
 * One card per document (29 October 2026).
 *
 * The merge has to do two things that pull against each other: stop asking for
 * the same document twice, and keep sending it. The second is the one that
 * makes a naive fix wrong — only a slot carrying `salesforceType` is pushed to
 * EPGL, and that flag was on the catalogue twin, so deleting the twin would
 * have left the MOA uploaded, ticked and never sent.
 *
 * These checks run against the real staging shape, built from the live
 * definition, and pin the three things a later change could quietly undo: the
 * type survives the merge, the expiry rule survives with it, and partners 2–8
 * are not silently folded onto partner 1's slot.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-document-slot-merge-2026-10-29.ts
 */
import { mergeDocumentSlots, MERGE_INTO, type Journey, type Slot } from "./lib/epglDocumentPairs";
import { sendableDocumentKeys, type EpglDocumentSlot } from "@/lib/epglComposite";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : (extra ?? ""));
  ok ? pass++ : fail++;
};

/** The staging shape, trimmed to the slots this touches. */
function journey(): Journey {
  return {
    key: "new_license",
    steps: [
      {
        key: "documents",
        documents: [
          { key: "trade_license", requirement: "mandatory" },
          { key: "moa", requirement: "optional", condition: "legal_form != 'Sole Establishment'" },
          { key: "partner_1_passport", requirement: "mandatory", condition: "partner_count >= 1 && partner_1_type != 'company'" },
          { key: "partner_1_emirates_id", requirement: "mandatory", condition: "partner_count >= 1 && partner_1_residence != 'Non Resident'" },
          { key: "partner_2_passport", requirement: "mandatory", condition: "partner_count >= 2" },
          { key: "partner_2_emirates_id", requirement: "mandatory", condition: "partner_count >= 2" },
          { key: "lease_contract", requirement: "optional" },
        ] as Slot[],
      },
      {
        key: "declarations",
        documents: [
          { key: "beneficial_ownership_declaration", requirement: "mandatory", salesforceType: "Beneficial Ownership Declaration" },
          { key: "copy_of_emirates_id", requirement: "mandatory", salesforceType: "Copy of Emirates ID", validityRequired: true, acceptedFormats: ["pdf"], maxSizeMb: 10 },
          { key: "copy_of_passport", requirement: "mandatory", salesforceType: "Copy of Passport", validityRequired: true, acceptedFormats: ["pdf"], maxSizeMb: 10 },
          { key: "memorandum_of_association", requirement: "mandatory", salesforceType: "Memorandum of Association" },
          { key: "lease_contract", requirement: "conditional", condition: "product_family == 'CEP30'", salesforceType: "Lease Contract", validityRequired: true },
          { key: "trade_licence_initial_name_approval", requirement: "conditional", condition: "product_family == 'CEP30'", salesforceType: "Trade Licence / Initial Name Approval", validityRequired: true },
          { key: "trade_licence", requirement: "conditional", condition: "product_family != 'CEP30'", salesforceType: "Trade Licence", validityRequired: true },
        ] as Slot[],
      },
    ],
  };
}

const slots = (j: Journey): Slot[] => (j.steps ?? []).flatMap((s) => s.documents ?? []);
const find = (j: Journey, key: string) => slots(j).find((d) => d.key === key);
const keysOf = (j: Journey) => slots(j).map((d) => d.key);

// ---- the double-ask is gone --------------------------------------------------
const j = journey();
const before = keysOf(j).length;
const report = mergeDocumentSlots(j);
const after = keysOf(j);

check("three catalogue twins are folded away", report.merged.length === 3, report.merged);
check("and the slot count drops by four — three twins and the duplicate lease contract",
  before - after.length === 4, { before, after: after.length });
for (const twin of ["memorandum_of_association", "copy_of_passport", "copy_of_emirates_id"]) {
  check(`${twin} no longer has a card of its own`, !after.includes(twin));
}
check("no key is declared in two steps any more", new Set(after).size === after.length, after);

// ---- and the document still reaches EPGL -------------------------------------
check('moa now carries EPGL\'s own name', find(j, "moa")?.salesforceType === "Memorandum of Association");
check("partner 1's passport carries theirs", find(j, "partner_1_passport")?.salesforceType === "Copy of Passport");
check("partner 1's Emirates ID carries theirs", find(j, "partner_1_emirates_id")?.salesforceType === "Copy of Emirates ID");
check("every type in the table sits on exactly one slot",
  Object.keys(MERGE_INTO).every((t) => slots(j).filter((d) => d.salesforceType === t).length === 1));

// The gate that decides what is pushed is the one in lib/epglComposite, so the
// merged slots are run through it rather than asserted about.
const sendable = sendableDocumentKeys(
  slots(j).map((d) => ({ key: d.key, salesforceType: d.salesforceType, validityRequired: d.validityRequired, validTo: d.validityRequired ? "2030-01-01" : undefined }) as EpglDocumentSlot)
);
for (const k of ["moa", "partner_1_passport", "partner_1_emirates_id"]) {
  check(`${k} is now pushed to Salesforce — it was not before`, sendable.includes(k), sendable);
}

// ---- the expiry rule travels with the name -----------------------------------
check("partner 1's passport keeps EPGL's expiry requirement",
  find(j, "partner_1_passport")?.validityRequired === true);
check("partner 1's Emirates ID keeps it too",
  find(j, "partner_1_emirates_id")?.validityRequired === true);
check("the MOA, which needs no expiry, is not given one",
  !find(j, "moa")?.validityRequired);
const undated = sendableDocumentKeys(
  slots(j).map((d) => ({ key: d.key, salesforceType: d.salesforceType, validityRequired: d.validityRequired }) as EpglDocumentSlot)
);
check("a merged slot with no expiry read off the file is still held back",
  !undated.includes("partner_1_passport") && !undated.includes("partner_1_emirates_id"), undated);

// ---- what is deliberately left alone ------------------------------------------
check("partner 2's passport is NOT folded onto partner 1's catalogue slot",
  find(j, "partner_2_passport")?.salesforceType === undefined);
check("so it is still not sent, rather than overwriting partner 1's",
  !sendable.includes("partner_2_passport"));
check("our trade licence slot is untouched — the catalogue has two, by family",
  find(j, "trade_license")?.salesforceType === undefined);
check("and both of the catalogue's trade licence slots survive",
  after.includes("trade_licence") && after.includes("trade_licence_initial_name_approval"));
check("the guidance's own keys still exist, so its upload blocks still resolve",
  ["trade_license", "moa", "partner_1_emirates_id"].every((k) => after.includes(k)));

// ---- the lease contract, which was one key in two steps ----------------------
check("the lease contract is declared once", after.filter((k) => k === "lease_contract").length === 1);
check("and it is the catalogue's one that survived",
  find(j, "lease_contract")?.salesforceType === "Lease Contract");

// ---- conditions are ours, not theirs ------------------------------------------
check("the MOA keeps our Sole Establishment condition",
  find(j, "moa")?.condition === "legal_form != 'Sole Establishment'");
check("partner 1's passport keeps our partner condition",
  String(find(j, "partner_1_passport")?.condition ?? "").includes("partner_count >= 1"));

// ---- running it twice changes nothing -----------------------------------------
const second = mergeDocumentSlots(j);
check("a second run finds nothing to merge", second.merged.length === 0, second);
check("and removes nothing", second.removed.length === 0 && second.deduped.length === 0, second);
/**
 * The one that was wrong first time round. A merged slot carries the type, so
 * a naive search for "the slot with this type" finds OUR slot, hunts for a
 * second one by the same key, and reports the pair as broken — which the
 * script turns into a refusal to write. Run against staging it failed exactly
 * here, before the --apply.
 */
check("and reports nothing missing — a merged slot is not its own twin",
  second.missing.length === 0, second.missing);
check("the slots are identical after it", JSON.stringify(keysOf(j)) === JSON.stringify(after));
const third = mergeDocumentSlots(j);
check("a third run is a no-op too",
  third.merged.length + third.removed.length + third.deduped.length + third.missing.length === 0, third);

// ---- a journey missing one of our slots is refused, not half-merged -----------
const partial: Journey = {
  key: "new_license",
  steps: [{ key: "declarations", documents: [{ key: "memorandum_of_association", salesforceType: "Memorandum of Association" }] as Slot[] }],
};
const partialReport = mergeDocumentSlots(partial);
check("a twin with no slot of ours is reported", partialReport.missing.length === 1, partialReport);
check("and is LEFT IN PLACE, so the document is not lost",
  keysOf(partial).includes("memorandum_of_association"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
