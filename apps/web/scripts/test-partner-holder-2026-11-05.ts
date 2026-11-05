/**
 * Partner 2's passport and Emirates ID, each in a slot of its own (5 Nov 2026).
 *
 * EPGL: "Partner 1's copy fills the normal slot, each further partner gets
 * their own slot" when the document item carries `Holder`. These check that
 * we send it, only on partners 2-8, and never send a later partner's document
 * without it (it would stack behind partner 1's again).
 *
 * Run from apps/web:  npx tsx scripts/test-partner-holder-2026-11-05.ts
 */
import {
  holderOf, needsHolder, documentCompositeBody, sendableDocumentKeys,
  withEpglDocumentItems, withEpglDocumentFiles, type EpglCaseFile,
} from "@/lib/epglComposite";
import { PARTNER_SALESFORCE_TYPES } from "@/lib/epglPartnerSlots";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

// The case data as pack 12 left it (conversation ccf0cf08…).
const data = {
  partner_count: "2",
  partner_1_name: "Ahmed Al Mansoori",
  partner_2_name: "Sara Al Hashimi",
  __partner_names: { "1": "Ahmed Al Mansoori", "2": "Sara Al Hashimi" },
};

console.log("\n1 · who holds what");
check("partner 1 has no holder — it fills the normal slot", holderOf("partner_1_passport", data) === undefined);
check("partner 2's passport is Sara's", holderOf("partner_2_passport", data) === "Sara Al Hashimi");
check("partner 2's Emirates ID is Sara's", holderOf("partner_2_emirates_id", data) === "Sara Al Hashimi");
check("falls back to the partner-names map", holderOf("partner_2_passport", { __partner_names: { "2": "Sara" } }) === "Sara");
check("a non-person document has none", holderOf("moa", data) === undefined && holderOf("copy_of_passport", data) === undefined);
check("no name, no holder", holderOf("partner_3_passport", data) === undefined);
check("partners 2-8 need one, partner 1 does not", needsHolder("partner_8_emirates_id") && !needsHolder("partner_1_passport"));
check("the config names partners 2-8, both documents", Object.keys(PARTNER_SALESFORCE_TYPES).length === 14 &&
  PARTNER_SALESFORCE_TYPES.partner_2_passport === "Copy of Passport" &&
  PARTNER_SALESFORCE_TYPES.partner_2_emirates_id === "Copy of Emirates ID" && !PARTNER_SALESFORCE_TYPES.partner_1_passport);

console.log("\n2 · the follow-up call");
const slots = [
  { key: "partner_1_passport", salesforceType: "Copy of Passport" },
  { key: "partner_2_passport", salesforceType: "Copy of Passport", holder: holderOf("partner_2_passport", data) },
  { key: "partner_2_emirates_id", salesforceType: "Copy of Emirates ID", holder: holderOf("partner_2_emirates_id", data) },
  { key: "partner_3_passport", salesforceType: "Copy of Passport", holder: holderOf("partner_3_passport", data) },
];
const body = documentCompositeBody("LR-1", slots) as any;
const items = body.compositeRequest.map((i: any) => i.body);
check("three go — partner 3 has no name, so it waits", items.length === 3, items);
check("partner 1's passport carries no Holder", items[0].Document_Type === "Copy of Passport" && !("Holder" in items[0]), items[0]);
check("partner 2's passport carries Sara as Holder", items[1].Holder === "Sara Al Hashimi" && items[1].Document_Type === "Copy of Passport", items[1]);
check("partner 2's Emirates ID too", items[2].Holder === "Sara Al Hashimi" && items[2].Document_Type === "Copy of Emirates ID", items[2]);
check("the keys recorded as sent match the items, in order",
  JSON.stringify(sendableDocumentKeys(slots)) === JSON.stringify(["partner_1_passport", "partner_2_passport", "partner_2_emirates_id"]));

console.log("\n3 · the create call, and the files under it");
const file = (key: string, t: string, name: string, holder?: string): EpglCaseFile =>
  ({ key, fileName: name, bytes: new TextEncoder().encode(name), salesforceType: t, holder });
const files = [
  file("partner_1_passport", "Copy of Passport", "ahmed-passport.pdf"),
  file("partner_2_passport", "Copy of Passport", "sara-passport.pdf", "Sara Al Hashimi"),
];
const create = { body: { allOrNone: true, compositeRequest: [
  { method: "POST", url: "/services/data/v60.0/sobjects/EPG_License_Request__c", referenceId: "NewLicenseRequest", body: {} },
] } };
const withItems = withEpglDocumentItems(create, files);
const docItems = ((withItems.input as any).body.compositeRequest as any[]).filter((i) => /EPG_Document__c$/.test(i.url));
check("both passports ride with the create", withItems.added.join() === "partner_1_passport,partner_2_passport", withItems.added);
check("...and only partner 2's names a Holder", !("Holder" in docItems[0].body) && docItems[1].body.Holder === "Sara Al Hashimi", docItems.map((i) => i.body));

const filled = await withEpglDocumentFiles(withItems.input, files, async () => null);
const fb = ((filled.input as any).body.compositeRequest as any[]).filter((i) => /EPG_Document__c$/.test(i.url)).map((i) => i.body);
check("partner 1's slot gets Ahmed's file", fb[0].fileName === "ahmed-passport.pdf", fb[0].fileName);
check("Sara's slot gets Sara's file", fb[1].fileName === "sara-passport.pdf", fb[1].fileName);

// The model writes its own items, in either order.
const modelFirst = { body: { allOrNone: true, compositeRequest: [
  { method: "POST", url: "/services/data/v60.0/sobjects/EPG_License_Request__c", referenceId: "NewLicenseRequest", body: {} },
  { method: "POST", url: "/services/data/v60.0/sobjects/EPG_Document__c", referenceId: "D1", body: { Document_Type: "Copy of Passport", Holder: "Sara Al Hashimi" } },
  { method: "POST", url: "/services/data/v60.0/sobjects/EPG_Document__c", referenceId: "D2", body: { Document_Type: "Copy of Passport" } },
] } };
const f2 = await withEpglDocumentFiles(modelFirst, files, async () => null);
const b2 = ((f2.input as any).body.compositeRequest as any[]).filter((i) => /EPG_Document__c$/.test(i.url)).map((i) => i.body);
check("an item naming Sara takes Sara's file even when it comes first", b2[0].fileName === "sara-passport.pdf", b2.map((b) => b.fileName));
check("...and the plain one takes Ahmed's", b2[1].fileName === "ahmed-passport.pdf", b2.map((b) => b.fileName));
const add2 = withEpglDocumentItems(modelFirst, files);
check("nothing is added twice when the model covered both", add2.added.length === 0, add2.added);

const onlyPlain = { body: { allOrNone: true, compositeRequest: [
  modelFirst.body.compositeRequest[0], modelFirst.body.compositeRequest[2],
] } };
const add3 = withEpglDocumentItems(onlyPlain, files);
check("the model's plain passport does not cover Sara's", add3.added.join() === "partner_2_passport", add3.added);

const noHolderFile = [file("partner_2_passport", "Copy of Passport", "sara.pdf")];
check("a partner-2 file with no holder never rides the create", withEpglDocumentItems(create, noHolderFile).added.length === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
