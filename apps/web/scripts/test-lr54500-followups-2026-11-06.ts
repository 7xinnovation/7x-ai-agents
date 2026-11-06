/**
 * Three small defects on LR-54500 (6 November 2026), none of which cost the
 * application anything:
 *   1. the create recorded what went under EPGL's names, so the follow-up sent
 *      the MOA and partner 1's passport and Emirates ID a second time;
 *   2. a trade-licence item under a name with no file was dropped, and the
 *      applicant was told their licence "didn't come through";
 *   3. two status pushes saying the same thing became two identical messages.
 *
 * Run from apps/web:  npx tsx scripts/test-lr54500-followups-2026-11-06.ts
 */
import { readFileSync } from "node:fs";
import { withEpglDocumentFiles, documentKeysByReference, type EpglCaseFile } from "@/lib/epglComposite";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const file = (key: string, t: string | undefined, name: string, extra: Partial<EpglCaseFile> = {}): EpglCaseFile =>
  ({ key, fileName: name, bytes: new TextEncoder().encode(name), salesforceType: t, ...extra });

// The case's files as LR-54500 held them.
const FILES = [
  file("trade_license", undefined, "01-trade-licence.pdf"),
  file("trade_licence_initial_name_approval", "Trade Licence / Initial Name Approval", "01-trade-licence.pdf", { validTo: "2027-12-31" }),
  file("moa", "Memorandum of Association", "03-memorandum-of-association.pdf"),
  file("partner_1_passport", "Copy of Passport", "04-copy-of-passport.pdf"),
  file("partner_1_emirates_id", "Copy of Emirates ID", "05-copy-of-emirates-id.pdf"),
  file("partner_2_passport", "Copy of Passport", "12-partner2-passport.pdf", { holder: "Sara Al Hashimi" }),
];
const doc = (ref: string, type: string) => ({
  method: "POST", url: "/services/data/v60.0/sobjects/EPG_Document__c", referenceId: ref,
  body: { EPG_License_Request__c: "@{NewLicenseRequest.id}", Document_Type: type },
});
// The model's own items, named as it named them on 6 November.
const CREATE = { body: { allOrNone: true, compositeRequest: [
  { method: "POST", url: "/services/data/v60.0/sobjects/EPG_License_Request__c", referenceId: "NewLicenseRequest", body: {} },
  doc("Doc_MOA", "Memorandum of Association"),
  doc("Doc_Partner1Passport", "Copy of Passport"),
  doc("Doc_Partner1EID", "Copy of Emirates ID"),
  doc("Doc_TradeLicence", "Trade Licence"),
] } };

console.log("\n1 · what went is recorded under OUR slot keys");
const filled = await withEpglDocumentFiles(CREATE, FILES, async () => null);
const byRef = documentKeysByReference(filled.input);
for (const [ref, key] of filled.byRef) byRef.set(ref, key);
check("the MOA is recorded as `moa`", byRef.get("Doc_MOA") === "moa", [...byRef]);
check("partner 1's passport as `partner_1_passport`", byRef.get("Doc_Partner1Passport") === "partner_1_passport", [...byRef]);
check("partner 1's Emirates ID as `partner_1_emirates_id`", byRef.get("Doc_Partner1EID") === "partner_1_emirates_id", [...byRef]);
check("(the old reading gave EPGL's slug, which the follow-up never matches)",
  documentKeysByReference(CREATE).get("Doc_MOA") === "memorandum_of_association");
check("the integration layer uses the filler's keys", /for \(const \[ref, key\] of filledByRef \?\? \[\]\) byRef\.set\(ref, key\)/.test(read("../lib/integrations.ts")));

console.log("\n2 · a trade-licence item under the 'wrong' name still finds the licence");
const items = ((filled.input as any).body.compositeRequest as any[]).filter((i) => /EPG_Document__c$/.test(i.url));
const lic = items.find((i) => i.referenceId === "Doc_TradeLicence");
check("it is not dropped", !!lic && filled.unmatched.length === 0, filled.unmatched);
check("it carries this application's catalogue name, never the one EPGL would refuse",
  lic?.body.Document_Type === "Trade Licence / Initial Name Approval", lic?.body.Document_Type);
check("...with the licence file", lic?.body.fileName === "01-trade-licence.pdf");
check("...recorded against the catalogue slot", filled.byRef.get("Doc_TradeLicence") === "trade_licence_initial_name_approval");
const onlyOurs = await withEpglDocumentFiles({ body: { compositeRequest: [doc("D", "Trade Licence")] } },
  [file("trade_license", undefined, "x.pdf")], async () => null);
check("a licence held only in our own (uncatalogued) slot is NOT sent under an invented name",
  onlyOurs.unmatched.length === 1 && onlyOurs.inlined.length === 0);
const second = await withEpglDocumentFiles({ body: { compositeRequest: [
  doc("A", "Trade Licence / Initial Name Approval"), doc("B", "Trade Licence")] } }, FILES, async () => null);
check("the licence is not sent twice when the model writes it twice", second.inlined.length === 1, second.inlined);

const integ = read("../lib/integrations.ts");
check("a dropped item no longer tells the model to ask for a re-upload",
  !/Ask the customer to upload the missing/.test(integ) && /do NOT tell them a document "didn't come through"/.test(integ));

console.log("\n3 · the same status twice is said once");
const st = read("../app/api/epgl/status/route.ts");
check("the last status message is compared before posting", /const repeated = .*last\.content === text/.test(st));
check("...and a repeat is not inserted", /if \(!repeated\) await getDb\(\)\.insert\(messages\)/.test(st));
check("...but still audited", /stale, repeated, body/.test(st));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
