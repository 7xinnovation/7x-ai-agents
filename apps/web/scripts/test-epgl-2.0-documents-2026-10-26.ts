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
check("our own MOA slot is held back — it has a catalogue twin", !sending.includes("moa"));
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
check("the 1.x push still requires a Salesforce record id",
  /\/\^\[a-zA-Z0-9\]\{15,18\}\$\/\.test\(submittedReference\)/.test(route));

// And the slot field has to survive config parsing, or every slot looks like ours.
const schema = readFileSync(resolve(here, "../../../packages/config/src/documents.ts"), "utf8");
check("salesforceType is on the DocumentRequirement schema, so zod keeps it",
  /salesforceType: z\.string\(\)\.optional\(\)/.test(schema));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
