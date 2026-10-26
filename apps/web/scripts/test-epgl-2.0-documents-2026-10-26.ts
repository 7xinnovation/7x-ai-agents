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
 * So the files now go in a second composite we compose ourselves. The two
 * things most worth pinning down:
 *
 *   - it is keyed on `applicationId__c`, the LR- reference. Their re-upload
 *     example is explicit about it, and it is NOT the Salesforce record id;
 *   - Document_Type must slug back to the slot key, because that is how the
 *     filler finds the bytes. A slot we cannot name from the catalogue is left
 *     out rather than sent under an invented type.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-2.0-documents-2026-10-26.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  documentTypeForKey,
  documentCompositeBody,
  sendableDocumentKeys,
  acceptedDocumentKeys,
  slugOfDocumentType,
  withEpglDocumentFiles,
  documentItemsOf,
  type EpglCaseFile,
} from "@/lib/epglComposite";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, "..", p), "utf8");

/** The real slot labels, as the staging definition carries them. */
const LABELS: Record<string, string> = {
  memorandum_of_association: "Memorandum of Association",
  copy_of_passport: "Copy of Passport",
  sme_licence_federal_or_local_government: "SME Licence (federal or local government)",
  insurance_certificate_goods_in_transit: "Insurance Certificate (goods in transit)",
  // Our own older slots, which hold the same files under hand-made keys.
  moa: "Memorandum of Association (MOA)",
  partner_1_passport: "Partner 1 — passport copy",
  trade_license: "Trade License / Initial Approval",
};
const nameOf = (k: string) => LABELS[k];

// ---- naming -----------------------------------------------------------------
check("a catalogue slot is named by the catalogue",
  documentTypeForKey("memorandum_of_association", LABELS.memorandum_of_association) === "Memorandum of Association");
check("brackets and casing survive the round trip",
  documentTypeForKey("sme_licence_federal_or_local_government", LABELS.sme_licence_federal_or_local_government) ===
    "SME Licence (federal or local government)");
check("one of our own slots is NOT named — it has a catalogue twin", documentTypeForKey("moa", LABELS.moa) === null);
check("...and neither is a partner passport", documentTypeForKey("partner_1_passport", LABELS.partner_1_passport) === null);
check("a slot with no label at all is never invented a name", documentTypeForKey("mystery_slot", undefined) === null);

// ---- the body ---------------------------------------------------------------
const KEYS = ["moa", "memorandum_of_association", "partner_1_passport", "copy_of_passport", "trade_license"];
const sending = sendableDocumentKeys(KEYS, nameOf);
check("only the catalogue slots are sent",
  JSON.stringify(sending) === JSON.stringify(["memorandum_of_association", "copy_of_passport"]), sending);

const body = documentCompositeBody("LR-54066", sending, nameOf) as {
  allOrNone: boolean;
  compositeRequest: { method: string; url: string; referenceId: string; body: Record<string, string> }[];
};
check("the body exists", !!body);
check("allOrNone is false — one bad slot must not roll back the rest", body.allOrNone === false);
check("one item per sendable slot", body.compositeRequest.length === 2);
check("each item creates an EPG_Document__c",
  body.compositeRequest.every((i) => i.url === "/services/data/v60.0/sobjects/EPG_Document__c" && i.method === "POST"));

// THE KEY THEIR CONTRACT USES. Not the record id.
check("keyed on applicationId__c, the LR- reference",
  body.compositeRequest.every((i) => i.body.applicationId__c === "LR-54066"));
check("...and the Salesforce record id appears nowhere in it",
  !JSON.stringify(body).includes("a11FW000vLNqvIWYQZ") && !/EPG_License_Request__c/.test(JSON.stringify(body)));

// THE OTHER HALF: the filler finds a file by slugging Document_Type back.
check("every Document_Type slugs back to its slot key",
  body.compositeRequest.every((i, n) => slugOfDocumentType(i.body.Document_Type!) === sending[n]!));
check("referenceIds are Doc1..DocN in the order sent",
  body.compositeRequest.map((i) => i.referenceId).join(",") === "Doc1,Doc2");

check("no application id, no body", documentCompositeBody("", sending, nameOf) === null);
check("no sendable slot, no body", documentCompositeBody("LR-1", ["moa", "trade_license"], nameOf) === null);
check("no slots at all, no body", documentCompositeBody("LR-1", [], nameOf) === null);

// ---- the bytes actually go in ----------------------------------------------
const files: EpglCaseFile[] = [
  { key: "memorandum_of_association", fileName: "moa.pdf", bytes: new Uint8Array(1024).fill(65), contentType: "application/pdf" },
  { key: "copy_of_passport", fileName: "pp.pdf", bytes: new Uint8Array(2048).fill(66), contentType: "application/pdf" },
];
const filled = await withEpglDocumentFiles({ body }, files, async () => null);
const items = documentItemsOf((filled.input as { body: Record<string, unknown> }).body);
check("the filler recognises what we composed", items.length === 2);
check("...and puts the bytes in", items.every((i) => typeof (i.body as { content?: string }).content === "string"));
check("nothing is left unmatched", filled.unmatched.length === 0, filled.unmatched);
check("both slots went inline", filled.inlined.length === 2, filled.inlined);

// ---- reading the answer back ------------------------------------------------
const answer = JSON.stringify({
  compositeResponse: [
    { referenceId: "Doc1", httpStatusCode: 201, body: { success: true, id: "a2xFW0001", errors: [] } },
    { referenceId: "Doc2", httpStatusCode: 400, body: { success: false, errors: ["bad"] } },
  ],
});
check("a slot their composite accepted is recorded",
  JSON.stringify(acceptedDocumentKeys(answer, sending)) === JSON.stringify(["memorandum_of_association"]));
check("a slot it refused is NOT recorded, so a later turn retries it",
  !acceptedDocumentKeys(answer, sending).includes("copy_of_passport"));
check("behind an HTTP status line it still reads", acceptedDocumentKeys(`HTTP 200\n${answer}`, sending).length === 1);
check("nonsense gives nothing rather than throwing", acceptedDocumentKeys("not json", sending).length === 0);
check("an empty result gives nothing", acceptedDocumentKeys(undefined, sending).length === 0);
check("a referenceId outside the batch is ignored",
  acceptedDocumentKeys(JSON.stringify({ compositeResponse: [{ referenceId: "Doc9", body: { success: true } }] }), sending).length === 0);

// ---- the route is wired -----------------------------------------------------
const route = read("app/api/chat/route.ts");
check("the push is gated on the application id, not on a record id",
  /\/\^LR-\\w\+\$\/i\.test\(epglApplicationId\)/.test(route));
check("...and only for EPGL", /agent\.definition\.tenantSlug === "epgl" &&\s*\n\s*epglApplicationId/.test(route));
check("it goes through the New Regulation composite",
  /allApiTools\.find\(\(t\) => isEpglCompositeTool\(t\.name\)\)/.test(route));
check("it skips what has already gone", /!alreadySent\.has\(d\.key\)/.test(route));
check("what went is written to the case so a later turn does not resend it",
  /\[SF_DOCS_SENT_KEY\]: \[/.test(route));
check("the order sent is the order read back", /acceptedDocumentKeys\(\(res as \{ raw\?: string \}\)\.raw \?\? res\.result, sending\)/.test(route));
check("it is deferred, like the 1.x push", /deferred\.push\(async \(\) => \{[\s\S]{0,400}documentCompositeBody/.test(route));
check("an outcome either way is auditable",
  /action: sent\.length \? "epgl_documents_attached" : "epgl_documents_failed"/.test(route));

// The 1.x path must be left exactly as it was — a different org entirely.
check("the 1.x push still requires a Salesforce record id",
  /submittedReference\) && \/\^\[a-zA-Z0-9\]\{15,18\}\$\/\.test\(submittedReference\)|\/\^\[a-zA-Z0-9\]\{15,18\}\$\/\.test\(submittedReference\)/.test(route));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
