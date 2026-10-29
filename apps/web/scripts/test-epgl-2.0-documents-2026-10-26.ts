/**
 * The 2.0 documents actually reach Salesforce (2026-10-26).
 *
 * Until today they did not. Every 2.0 composite the model has sent carries
 * exactly Account, the owners, the Contact and the licence request — never an
 * EPG_Document__c — so the filler in lib/epglComposite had nothing to fill, and
 * the deferred push that covers 1.x could not reach a 2.0 application: it is
 * gated on the case reading `status: "submitted"` with a 15-18 character record
 * id, and 2.0 leaves the case `ready` with the id only in
 * `data.application_id`, as `LR-54066`. Their getApplicationStatus for that
 * application reported all ten slots `uploaded: false`.
 *
 * So the files go in a second composite we compose ourselves. Three things are
 * worth pinning down, and the first run against their sandbox taught two of
 * them the hard way:
 *
 *   - it is keyed on `applicationId__c`, the LR- reference. Their re-upload
 *     example is explicit about it, and it is NOT the Salesforce record id;
 *   - only slots their checklist knows are sent. The first attempt also sent
 *     `partner_1_emirates_id` and was told `Document_Type "Partner 1 — Emirates
 *     ID" is not required for this application`. `salesforceType` is set on a
 *     catalogue-generated slot and on no other, so its absence is the test;
 *   - a refusal is final — allOrNone is false — so it is recorded and never
 *     retried. Six slots want a Valid_To__c the journey does not collect, and
 *     without this they would be re-posted as base64 on every later turn.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-2.0-documents-2026-10-26.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  withEpglDocumentItems,
  documentKeysByReference,
  documentOutcomesByReference,
  documentCompositeBody,
  sendableDocumentKeys,
  documentOutcomes,
  slugOfDocumentType,
  withEpglDocumentFiles,
  documentItemsOf,
  type EpglDocumentSlot,
  type EpglCaseFile,
} from "@/lib/epglComposite";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, "..", p), "utf8");

/**
 * The real slots, as the staging definition carries them. The catalogue-made
 * ones have a salesforceType; ours do not, and that is the whole distinction.
 */
const SLOTS: EpglDocumentSlot[] = [
  { key: "moa" },
  { key: "partner_1_emirates_id" },
  { key: "trade_license" },
  { key: "memorandum_of_association", salesforceType: "Memorandum of Association" },
  { key: "copy_of_passport", salesforceType: "Copy of Passport" },
  { key: "trade_licence_initial_name_approval", salesforceType: "Trade Licence / Initial Name Approval", validTo: "2027-12-31" },
];

// ---- what goes, and what does not -------------------------------------------
const sending = sendableDocumentKeys(SLOTS);
check("only slots EPGL's checklist knows are sent",
  JSON.stringify(sending) === JSON.stringify(["memorandum_of_association", "copy_of_passport", "trade_licence_initial_name_approval"]), sending);
check("a slot with no catalogue type is held back", !sending.includes("moa"));
// The real journey's `moa` carries "Memorandum of Association" since the
// 29 October merge, so this fixture is now a shape rather than a quotation of
// it. What it pins is the gate, which is unchanged: no type, not sent.
check("and the partner Emirates ID their API refused by name is too",
  !sending.includes("partner_1_emirates_id"));

const body = documentCompositeBody("LR-54066", SLOTS) as {
  allOrNone: boolean;
  compositeRequest: { method: string; url: string; referenceId: string; body: Record<string, string> }[];
};
check("the body exists", !!body);
check("allOrNone is false — one refused slot must not roll back the rest", body.allOrNone === false);
check("one item per sendable slot, and no more", body.compositeRequest.length === 3);
check("each item creates an EPG_Document__c",
  body.compositeRequest.every((i) => i.url === "/services/data/v60.0/sobjects/EPG_Document__c" && i.method === "POST"));

// THE KEY THEIR CONTRACT USES. Not the record id.
check("keyed on applicationId__c, the LR- reference",
  body.compositeRequest.every((i) => i.body.applicationId__c === "LR-54066"));
check("...and no Salesforce record id appears anywhere in it",
  !/EPG_License_Request__c|a11FW000/.test(JSON.stringify(body)));
check("Document_Type is the catalogue's name verbatim",
  body.compositeRequest[0]!.body.Document_Type === "Memorandum of Association");

// THE OTHER HALF: the filler finds a file by slugging Document_Type back.
check("every Document_Type still slugs back to its slot key",
  body.compositeRequest.every((i, n) => slugOfDocumentType(i.body.Document_Type!) === sending[n]!));
check("referenceIds are Doc1..DocN in the order sent",
  body.compositeRequest.map((i) => i.referenceId).join(",") === "Doc1,Doc2,Doc3");

// ---- Valid_To__c ------------------------------------------------------------
check("a validity date the case knows is sent",
  body.compositeRequest[2]!.body.Valid_To__c === "2027-12-31");
check("...and a date we do NOT know is never invented",
  !("Valid_To__c" in body.compositeRequest[1]!.body));

check("no application id, no body", documentCompositeBody("", SLOTS) === null);
check("no sendable slot, no body", documentCompositeBody("LR-1", [{ key: "moa" }]) === null);
check("no slots at all, no body", documentCompositeBody("LR-1", []) === null);

// ---- the bytes actually go in ----------------------------------------------
const files: EpglCaseFile[] = sending.map((k) => ({
  key: k, fileName: `${k}.pdf`, bytes: new Uint8Array(1024).fill(65), contentType: "application/pdf",
}));
const filled = await withEpglDocumentFiles({ body }, files, async () => null);
const items = documentItemsOf((filled.input as { body: Record<string, unknown> }).body);
check("the filler recognises what we composed", items.length === 3);
check("...and puts the bytes in", items.every((i) => typeof (i.body as { content?: string }).content === "string"));
check("nothing is left unmatched", filled.unmatched.length === 0, filled.unmatched);

// ---- reading the answer back, successes AND refusals ------------------------
// Their real answer on LR-54066, 26 October.
const answer = JSON.stringify({
  compositeResponse: [
    { referenceId: "Doc1", httpStatusCode: 200, body: { success: true, id: "a0vFW008KYiKZxQYYW", errors: [] } },
    { referenceId: "Doc2", httpStatusCode: 400, body: { success: false, errors: ["Valid_To__c is required for this document"] } },
    { referenceId: "Doc3", httpStatusCode: 400, body: { success: false, errors: ['Document_Type "x" is not required for this application'] } },
  ],
});
const outcome = documentOutcomes(answer, sending);
check("a slot their composite accepted is recorded as sent",
  JSON.stringify(outcome.sent) === JSON.stringify(["memorandum_of_association"]));
check("a refused slot is recorded as refused, not silently dropped", outcome.refused.length === 2);
check("...with their reason, verbatim",
  outcome.refused[0]!.reason === "Valid_To__c is required for this document", outcome.refused);
check("a refused slot is NOT counted as sent",
  !outcome.sent.includes("copy_of_passport"));
check("behind an HTTP status line it still reads", documentOutcomes(`HTTP 200\n${answer}`, sending).sent.length === 1);
check("nonsense gives nothing rather than throwing", documentOutcomes("not json", sending).sent.length === 0);
check("an empty result gives nothing", documentOutcomes(undefined, sending).refused.length === 0);
check("a referenceId outside the batch is ignored",
  documentOutcomes(JSON.stringify({ compositeResponse: [{ referenceId: "Doc9", body: { success: true } }] }), sending).sent.length === 0);
check("a refusal with no message still names the slot",
  documentOutcomes(JSON.stringify({ compositeResponse: [{ referenceId: "Doc1", httpStatusCode: 500, body: {} }] }), sending).refused[0]?.key ===
    "memorandum_of_association");

// ---- the one-call body: documents travel WITH the create --------------------
const CREATE = () => ({
  body: {
    allOrNone: true,
    compositeRequest: [
      { method: "POST", url: "/services/data/v60.0/sobjects/Account", referenceId: "NewAccount", body: { Name: "X" } },
      { method: "POST", url: "/services/data/v60.0/sobjects/EPG_License_Request__c", referenceId: "NewLicenseRequest", body: { Product_Code: "CEP30-UAE-SME-DOM" } },
      { method: "POST", url: "/services/data/v60.0/sobjects/Application_Item__c", referenceId: "Item1", body: { License_Request__c: "@{NewLicenseRequest.id}" } },
    ],
  },
});
const FILES: EpglCaseFile[] = [
  { key: "moa", fileName: "a.pdf", bytes: new Uint8Array(8), contentType: "application/pdf" },
  { key: "memorandum_of_association", fileName: "b.pdf", bytes: new Uint8Array(8), contentType: "application/pdf", salesforceType: "Memorandum of Association" },
  { key: "copy_of_passport", fileName: "c.pdf", bytes: new Uint8Array(8), contentType: "application/pdf", salesforceType: "Copy of Passport", validTo: "2034-01-01" },
];

// A slot EPGL will refuse for want of a date must not ride in an allOrNone
// create -- on 26 October two such documents rolled back a whole submission.
const NEEDS_DATE: EpglCaseFile = {
  key: "insurance_certificate_goods_in_transit", fileName: "i.pdf", bytes: new Uint8Array(8),
  salesforceType: "Insurance Certificate (goods in transit)", validityRequired: true,
};
check("a slot owing an expiry we do not have stays out of the create",
  withEpglDocumentItems(CREATE(), [NEEDS_DATE]).added.length === 0);
check("...and goes in once the date is known",
  withEpglDocumentItems(CREATE(), [{ ...NEEDS_DATE, validTo: "2027-12-31" }]).added.length === 1);
check("a slot that owes no date rides without one",
  withEpglDocumentItems(CREATE(), [{ key: "memorandum_of_association", fileName: "m.pdf", bytes: new Uint8Array(8), salesforceType: "Memorandum of Association" }]).added.length === 1);
check("the follow-up call still takes it, since a refusal there costs only the slot",
  sendableDocumentKeys([{ key: NEEDS_DATE.key, salesforceType: NEEDS_DATE.salesforceType }]).length === 1);

const one = withEpglDocumentItems(CREATE(), FILES);
const oneItems = (one.input as { body: { compositeRequest: { referenceId: string; url: string; body: Record<string, string> }[] } }).body.compositeRequest;
check("the documents are added to the create", one.added.length === 2);
check("our own slots are left out here too", !one.added.includes("moa"));
check("they reference the application being created, by its referenceId",
  oneItems.filter((i) => /EPG_Document__c$/.test(i.url)).every((i) => i.body.EPG_License_Request__c === "@{NewLicenseRequest.id}"));
check("...which is their documented reference syntax",
  JSON.stringify(one.input).includes('"@{NewLicenseRequest.id}"'));
check("and NOT the follow-up call's applicationId__c",
  !JSON.stringify(oneItems.filter((i) => /EPG_Document__c$/.test(i.url))).includes("applicationId__c"));
check("they sit AFTER the application item, as their example has it",
  oneItems.findIndex((i) => i.referenceId === "NewLicenseRequest") < oneItems.findIndex((i) => /EPG_Document__c$/.test(i.url)));
check("the expiry rides along", oneItems.find((i) => i.referenceId === "Doc2")?.body.Valid_To__c === "2034-01-01");
check("nothing else in the create is disturbed",
  oneItems.filter((i) => !/EPG_Document__c$/.test(i.url)).map((i) => i.referenceId).join(",") === "NewAccount,NewLicenseRequest,Item1");

// The bytes still go in, to the items we added.
const oneFilled = await withEpglDocumentFiles(one.input, FILES, async () => null);
check("the filler fills what we injected", oneFilled.inlined.length === 2, oneFilled);
check("...and leaves nothing unmatched", oneFilled.unmatched.length === 0, oneFilled.unmatched);

// Guards.
check("a composite the model already put documents in is left alone", (() => {
  const withDocs = CREATE();
  withDocs.body.compositeRequest.push({ method: "POST", url: "/services/data/v60.0/sobjects/EPG_Document__c", referenceId: "Doc1", body: {} } as never);
  return withEpglDocumentItems(withDocs, FILES).added.length === 0;
})());
check("a composite that creates no application is left alone", (() => {
  const noReq = { body: { allOrNone: true, compositeRequest: [{ method: "POST", url: "/services/data/v60.0/sobjects/Account", referenceId: "A", body: {} }] } };
  return withEpglDocumentItems(noReq, FILES).added.length === 0;
})());
check("no catalogue slot, nothing added", withEpglDocumentItems(CREATE(), [FILES[0]!]).added.length === 0);
check("an empty composite is left alone", withEpglDocumentItems({ body: {} }, FILES).added.length === 0);
check("a renamed application item is still referenced correctly", (() => {
  const renamed = CREATE();
  renamed.body.compositeRequest[1]!.referenceId = "TheApplication";
  return JSON.stringify(withEpglDocumentItems(renamed, FILES).input).includes("@{TheApplication.id}");
})());

// ---- documents the MODEL composed are recorded too ---------------------------
// 26 October: the model emitted the items itself with names of its own, all ten
// passed with the create, and the follow-up then re-sent the same ten because
// nothing had recorded that they had gone. Two went the second time without the
// expiry the model had supplied, and EPGL marked two passing documents failed.
const MODEL_COMPOSED = {
  body: {
    allOrNone: true,
    compositeRequest: [
      { method: "POST", url: "/services/data/v60.0/sobjects/EPG_License_Request__c", referenceId: "NewLicenseRequest", body: {} },
      { method: "POST", url: "/services/data/v60.0/sobjects/EPG_Document__c", referenceId: "Doc_MOA", body: { Document_Type: "Memorandum of Association" } },
      { method: "POST", url: "/services/data/v60.0/sobjects/EPG_Document__c", referenceId: "Doc_LeaseContract", body: { Document_Type: "Lease Contract", Valid_To__c: "2027-12-31" } },
    ],
  },
};
const byRef = documentKeysByReference(MODEL_COMPOSED);
check("a model-composed document item is mapped back to its slot",
  byRef.get("Doc_MOA") === "memorandum_of_association" && byRef.get("Doc_LeaseContract") === "lease_contract");
check("non-document items are not mapped", !byRef.has("NewLicenseRequest"));
check("our own injected items map too",
  documentKeysByReference(withEpglDocumentItems(CREATE(), FILES).input).get("Doc1") === "memorandum_of_association");

const modelAnswer = JSON.stringify({ compositeResponse: [
  { referenceId: "NewLicenseRequest", httpStatusCode: 200, body: { success: true } },
  { referenceId: "Doc_MOA", httpStatusCode: 200, body: { success: true } },
  { referenceId: "Doc_LeaseContract", httpStatusCode: 400, body: { success: false, errors: ["Valid_To__c is required for this document"] } },
]});
const modelOutcome = documentOutcomesByReference(modelAnswer, byRef);
check("what the model's composite attached is recorded",
  JSON.stringify(modelOutcome.sent) === JSON.stringify(["memorandum_of_association"]));
check("...and what it refused, with the reason",
  modelOutcome.refused[0]?.key === "lease_contract");
check("the application item is not mistaken for a document", modelOutcome.sent.length + modelOutcome.refused.length === 2);
check("an unknown referenceId is ignored",
  documentOutcomesByReference(JSON.stringify({ compositeResponse: [{ referenceId: "Nope", body: { success: true } }] }), byRef).sent.length === 0);
check("no documents in the composite, nothing recorded", documentKeysByReference(CREATE()).size === 0);

// ---- the route is wired -----------------------------------------------------
const route = read("app/api/chat/route.ts");
check("the push is gated on the application id, not on a record id",
  /\/\^LR-\\w\+\$\/i\.test\(epglApplicationId\)/.test(route));
check("...and only for EPGL", /agent\.definition\.tenantSlug === "epgl" &&\s*\n\s*epglApplicationId/.test(route));
check("it goes through the New Regulation composite",
  /allApiTools\.find\(\(t\) => isEpglCompositeTool\(t\.name\)\)/.test(route));
check("the slot's EPGL name comes from the journey definition",
  /salesforceType: byKey\.get\(d\.key\)\?\.salesforceType/.test(route));
check("it skips what has already gone", /!alreadySent\.has\(d\.key\)/.test(route));
check("and what their API already refused", /!refusedAlready\.has\(d\.key\)/.test(route));
check("a refusal is written to the case with its reason",
  /\[EPGL_DOCS_REFUSED_KEY\]: \{/.test(route));
check("what went is written to the case so a later turn does not resend it",
  /\[SF_DOCS_SENT_KEY\]: \[/.test(route));
check("the order sent is the order read back",
  /documentOutcomes\(\(res as \{ raw\?: string \}\)\.raw \?\? res\.result, sending\)/.test(route));
check("it is deferred, like the 1.x push", /deferred\.push\(async \(\) => \{[\s\S]{0,400}documentCompositeBody/.test(route));
check("an outcome either way is auditable",
  /action: sent\.length \? "epgl_documents_attached" : "epgl_documents_failed"/.test(route));
check("the expiry comes off the file itself", /if \(doc\.validTo\) return doc\.validTo;/.test(route));
check("...with the trade licence field as a fallback for older uploads",
  /doc\.key === "trade_licence_initial_name_approval" \|\| doc\.key === "trade_licence"/.test(route));

// The date has to be KEPT at upload, or there is nothing to send.
const upload = read("app/api/upload/route.ts");
check("the printed expiry is recorded on the case document",
  /validTo: extraction\.docExpiryDate/.test(upload));
check("a replaced file clears what EPGL said about the old one",
  /__epgl_documents_refused/.test(upload) && /k !== key/.test(upload));
const caseSchema = readFileSync(resolve(here, "../../../packages/config/src/case.ts"), "utf8");
check("validTo survives config parsing", /validTo: z\.string\(\)\.optional\(\)/.test(caseSchema));

// The 1.x path must be left exactly as it was — a different Salesforce org.
check("the create call carries the documents", /withEpglDocumentItems\(input, files\)/.test(read("lib/integrations.ts")));
check("...and what EPGL said about them is kept",
  /rememberEpglDocuments/.test(read("lib/integrations.ts")) && /rememberEpglDocuments:/.test(route));
check("recorded off the request, so a model-composed create counts too",
  /documentKeysByReference\(input\)/.test(read("lib/integrations.ts")));
check("so the follow-up push does not re-send them",
  /!epglDocumentsHandled\.sent\.includes\(d\.key\)/.test(route));

check("the 1.x push still requires a Salesforce record id",
  /\/\^\[a-zA-Z0-9\]\{15,18\}\$\/\.test\(submittedReference\)/.test(route));

// And the slot field has to survive config parsing, or every slot looks like ours.
const schema = readFileSync(resolve(here, "../../../packages/config/src/documents.ts"), "utf8");
check("salesforceType is on the DocumentRequirement schema, so zod keeps it",
  /salesforceType: z\.string\(\)\.optional\(\)/.test(schema));
check("...and so is validityRequired, which gates the create",
  /validityRequired: z\.boolean\(\)\.optional\(\)/.test(schema));
check("the generator carries it off the catalogue",
  /validityRequired: Boolean\(e\.doc\.validityRequired\)/.test(read("scripts/epgl-2.0-journey-2026-10-20.ts")));

// ---------------------------------------- the follow-up call filters too
//
// The create path has refused to send a validityRequired slot with no expiry
// since 26 October. The follow-up path did not, and sent them anyway: LR-54066
// ended at seven of ten that way, and LR-54086's lease contract and insurance
// certificate were posted to the same certain refusal twice on one turn.
{
  const slots = [
    { key: "moa", salesforceType: "Memorandum of Association" },
    { key: "lease_contract", salesforceType: "Lease Contract", validityRequired: true },
    { key: "trade_licence", salesforceType: "Trade Licence", validityRequired: true, validTo: "2027-12-31" },
    { key: "ours_only", validityRequired: true },
  ];
  const keys = sendableDocumentKeys(slots);
  check("a slot with no expiry their catalogue demands is not sent", !keys.includes("lease_contract"), keys);
  check("...but the same slot WITH the expiry is", keys.includes("trade_licence"));
  check("a slot that needs no expiry is unaffected", keys.includes("moa"));
  check("our own slots are still never sent", !keys.includes("ours_only"));
  const body = documentCompositeBody("LR-54086", slots) as { compositeRequest: { body: Record<string, unknown> }[] };
  check("the body carries exactly those slots, in that order",
    body.compositeRequest.map((i) => i.body.Document_Type).join("|") === "Memorandum of Association|Trade Licence",
    body.compositeRequest.map((i) => i.body.Document_Type));
  check("...so the outcome is recorded against the right keys",
    body.compositeRequest.length === keys.length);
  check("nothing sendable at all is no call, not an empty one",
    documentCompositeBody("LR-54086", [{ key: "lease_contract", salesforceType: "Lease Contract", validityRequired: true }]) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);