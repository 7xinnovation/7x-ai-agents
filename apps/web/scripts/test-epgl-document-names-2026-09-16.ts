/**
 * EPGL's own checklist names, and the one thing they still do not settle.
 *
 * Section 4 of the LR-37377 payload note asked how to name a document we collect
 * once per partner so that it both matches a checklist entry and does not
 * overwrite the partner before. On 16 September EPGL answered with the active
 * checklist names — 80-odd of them across every service — and the half of the
 * question they did answer:
 *
 *   "below are the active checklist documents names that you can match on them
 *    to avoid overriding existing documents, like for passport we have 3
 *    passport document names: Passport, Passport copy-Partner and Passport (Of
 *    All Branch Partners)"
 *
 * So the owner's passport and a partner's passport are DIFFERENT slots, and we
 * had been sending both under one. The other half — three partners, one
 * "Passport copy-Partner" — is still ours to handle, and this is where that
 * decision is written down.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-document-names-2026-09-16.ts
 */
import { readFileSync } from "node:fs";
import { epglDocumentLabel, epglDocumentLabels } from "../lib/epglDocumentLabel";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

/** Their list, verbatim — every name our journeys can produce must be in it. */
const ACTIVE = new Set([
  "Trade License", "Upload Trade License", "Lease Contract",
  "Acknowledgement Letter for Submitting the Financial Statement", "Trade License (Main Branch)",
  "Last Fiscal Year Audited Financial Statement", "Memorandum of Association", "Updated Trade License",
  "Company Stakeholder Agreement", "Reservation of Trade Name", "Trade License with Updated Location",
  "Initial Approval From Economic Department", "Payment Receipt", "NOC Letter",
  "Branch Trade License or initial Approval from Regulator", "NOC Document", "NOC", "Postal License",
  "Upload Payment Receipt", "Trade License/Trade Name", "Passport", "Emirates Id", "Other Document",
  "Branch Trade License", "Initial Approval from Regulator", "Trade License-Partner",
  "Acknowledgment letter for not performing the license activities in the market",
  "Updated trade license copy", "Official Letter of Cancellation",
  "Full revenue data of last licensing period", "Form 9 for each quarter", "Copy Of Family Book",
  "Passport copy-Partner", "Updated Trade License Copy", "Newspaper Report", "Emirates ID-Partner",
  "Last fiscal year audited financial statements", "Settling all levies and penalties Payment Receipts",
  "DED Rejection Form", "Copy of Trade license", "Settlement of Payment and Fines",
  "Transactions file (Full revenue file) of last licensing period", "Memorandom Of Association-Partner",
  "Upload Newspaper Proof", "Copy of Postal License", "Copy of Emirates ID",
  "Last fiscal year Audited Financial Statement", "Memorandum of association", "Authorized Signatory",
  "Initial Commitment Form", "VAT File", "Trail Balance for the License Period",
  "Passport (Of All Branch Partners)", "Emirates Id (Of All Branch Partners)",
  "Memorandum of Association (Of All Branches)", "Trade License (Of All Branches)",
]);

/** Every document key the two live EPGL journeys collect, as of 16 September. */
const NEW_LICENCE = [
  "trade_license", "moa", "lease_contract",
  ...Array.from({ length: 8 }, (_, i) => [`partner_${i + 1}_passport`, `partner_${i + 1}_emirates_id`]).flat(),
];
const RENEWAL = [
  "updated_trade_license", "audited_financial_statement", "acknowledgement_letter", "financial_statement",
  "lease_contract",
  ...Array.from({ length: 8 }, (_, i) => [`partner_${i + 1}_passport`, `partner_${i + 1}_emirates_id`]).flat(),
];

console.log("\nEvery name we send is a name on their checklist");
for (const journey of [NEW_LICENCE, RENEWAL]) {
  const labels = epglDocumentLabels(journey, { partnerName: () => undefined });
  for (const [key, label] of labels) {
    // The repeats carry the partner beside the checklist name; the base must match.
    const base = label.replace(/ - (?:Partner \d+|.+)$/, "");
    check(`${key} → ${label}`, ACTIVE.has(base), base);
  }
}

console.log("\nThe two that moved");
check("the trade licence is their checklist spelling, not their data's", epglDocumentLabel("trade_license") === "Trade License");
check("a partner's passport is not the owner's slot", epglDocumentLabel("partner_1_passport") === "Passport copy-Partner");
check("...and the owner's is", epglDocumentLabel("passport") === "Passport");
check("a partner's Emirates ID is its own slot", epglDocumentLabel("partner_1_emirates_id") === "Emirates ID-Partner");
check("...and the owner's is", epglDocumentLabel("emirates_id") === "Emirates Id");

console.log("\nThree partners, one checklist entry");
{
  const keys = ["partner_1_passport", "partner_2_passport", "partner_3_passport"];
  const names: Record<number, string> = { 1: "Faisal Eissa Lutfi Ali Hussain", 2: "Abdelaziz Mohamed Obaid", 3: "Valentina Mintah" };
  const labels = epglDocumentLabels(keys, { partnerName: (n) => names[n] });
  check("the first fills the checklist slot", labels.get("partner_1_passport") === "Passport copy-Partner", labels.get("partner_1_passport"));
  check("the second says whose it is", labels.get("partner_2_passport") === "Passport copy-Partner - Abdelaziz Mohamed Obaid", labels.get("partner_2_passport"));
  check("the third too", labels.get("partner_3_passport") === "Passport copy-Partner - Valentina Mintah", labels.get("partner_3_passport"));
  check("so no two documents share a label", new Set(labels.values()).size === 3, [...labels.values()]);

  // THE POINT OF ALL OF IT: the label is the dedup key, so a repeated label is a
  // file that replaces another file. LR-37214 arrived with one passport.
  const collided = new Set(keys.map(() => "Passport copy-Partner"));
  check("...which the naive mapping would not have managed", collided.size === 1);
}
{
  // A partner with no name off the licence still gets a distinct label.
  const labels = epglDocumentLabels(["partner_1_passport", "partner_2_passport"], {});
  check("an unnamed partner is numbered", labels.get("partner_2_passport") === "Passport copy-Partner - Partner 2", labels.get("partner_2_passport"));
}
{
  // FIRST IS BY PARTNER NUMBER, NOT BY UPLOAD ORDER. Documents are pushed over
  // several turns; a slot that renamed itself between turns would upload twice,
  // and the second upload would not update the first.
  const forwards = epglDocumentLabels(["partner_2_passport", "partner_4_passport"], {});
  const backwards = epglDocumentLabels(["partner_4_passport", "partner_2_passport"], {});
  check("order does not decide who holds the slot", forwards.get("partner_2_passport") === "Passport copy-Partner" && backwards.get("partner_2_passport") === "Passport copy-Partner", [...forwards], );
  check("...and the other is stable either way", forwards.get("partner_4_passport") === backwards.get("partner_4_passport"));
  // Emirates IDs are their own kind: partner 2 holds the passport slot AND the
  // Emirates ID slot when no lower-numbered partner has one.
  const mixed = epglDocumentLabels(["partner_2_passport", "partner_2_emirates_id", "partner_3_emirates_id"], {});
  check("each kind has its own first", mixed.get("partner_2_emirates_id") === "Emirates ID-Partner", mixed.get("partner_2_emirates_id"));
  check("...and its own repeats", mixed.get("partner_3_emirates_id") === "Emirates ID-Partner - Partner 3");
}

console.log("\nA key nobody has mapped");
check("falls back to the journey's own label", epglDocumentLabel("some_new_thing", { fallback: "Board resolution" }) === "Board resolution");
check("...and to something readable when there is none", epglDocumentLabel("some_new_thing") === "some new thing");

console.log("\nUsed by the upload, from the whole case");
{
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  check("the labels are decided together", /epglDocumentLabels\(\s*finalState\.documents\.map/.test(route));
  check("...including documents already sent, so a turn cannot rename a slot", /finalState\.documents\.map\(\(doc\) => doc\.key\)/.test(route));
  check("...and each upload reads its own", /const label = docLabelsForEpgl\.get\(d\.key\)/.test(route));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
