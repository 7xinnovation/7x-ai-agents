/**
 * EPGL 2.0 guidance, brought up to Salesforce's 21 October pack.
 *
 * The 20 October block was written while six things were still open. Five of
 * them are now answered, and the block as it stands tells the model the
 * opposite of what their API does:
 *
 *   - It says APPLICATIONID IS NOT SETTLED. It is: Salesforce mint it and hand
 *     it back as body.applicationId (LR-xxxxx) on the NewLicenseRequest item,
 *     and an id we invent is rejected.
 *   - It says a missing application answers HTTP 200 with 404 in the body. It
 *     now answers a real HTTP 404.
 *   - It says PDF only, and to tell a customer holding a photo of their
 *     Emirates ID that we cannot take it. Passport and Emirates ID now accept
 *     JPG and PNG, so that sentence turns a working upload into a refusal.
 *   - It says documents are base64 inside the composite. Above about 4 MB they
 *     cannot be — there is a two-step upload for those.
 *   - It never mentions isAgent_Request__c, which is how Emirates Post tell an
 *     assistant submission from a portal one.
 *
 * All five were verified against the NewLaw sandbox on 21 October before this
 * was written, including the two that needed a write: a re-sent create returned
 * the SAME application (LR-54039, not a second one), and a 6.27 MB file went up
 * through ContentVersion and attached to its slot.
 *
 * Replaces the 20 October block by marker rather than prepending a second one —
 * two blocks of contradicting guidance is the failure this is fixing.
 *
 * Idempotent. Dry run by default. Run from apps/web:
 *   npx tsx scripts/epgl-2.0-guidance-2026-10-21.ts [--env <file>] [--apply]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({ path: envArg !== -1 && process.argv[envArg + 1]
  ? resolve(process.argv[envArg + 1]!)
  : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const SLUG = "epgl-dialog";
const JOURNEY = "new_license";
export const MARKER = "EPGL 2.0 — NEW REGULATION (2026-10-21)";
/**
 * The block this replaces. Written out rather than imported: that module calls
 * main() at the top level, so importing it would run the 20 October script as a
 * side effect of reading one constant from it.
 */
const OLD_MARKER = "EPGL 2.0 — NEW REGULATION (2026-10-20)";

const T = "epgl_new_regulation__";

export const GUIDANCE =
`${MARKER}. Everything in this block supersedes the older composite instructions further down, which describe the previous licensing API and apply only to renewals.

THE ORDER IS FIXED, AND THE PRODUCT COMES FIRST. Ask which licence or permit they want before anything else: every later question and every document depends on it. The moment they choose, set product_family yourself — CEP30 for any CEP30-* product, otherwise the product code — and set product_is_sme true when the code contains SME. Never ask for either; they are derived, and they are what the later questions are conditioned on.

THE APPLICATION NUMBER IS THEIRS TO ISSUE, NOT OURS. Never send applicationId__c when creating an application — an id Salesforce did not mint is rejected. The create response carries it back as body.applicationId on the NewLicenseRequest item, in the form LR-xxxxx, and THAT is the number the customer quotes and the key for every later call: documents, pricing, status, information requests and the licence. Do not invent a reference, and do not give the customer one before the create has answered.

A SUBMISSION THAT MAY HAVE LANDED IS SAFE TO SEND AGAIN. If a create times out, re-sending the same application returns the application that already exists rather than making a second one — confirmed against their sandbox. So a timeout is not a reason to leave the customer without a number: send it again and read the id off the answer.

SAY IT CAME THROUGH THE ASSISTANT. Set isAgent_Request__c true on the application item on every submission made here. Emirates Post use it to tell an assistant application from a portal one, and it comes back as agentRequest on the status call.

THE PRICE COMES FROM THEM, NEVER FROM YOU. Call ${T}post_services_apexrest_payment_pricing and quote what it returns. Do not add, round, total or infer a fee, and do not read one out of the catalogue — the catalogue is what they may charge, the pricing call is what THIS application costs. It answers with line items, a currency, an invoice reference and an expiry; quote the items and say when the quote expires. Payment above the catalogue's onlinePaymentThresholdAed cannot be taken online — read that threshold from the catalogue, never hard-code it.

AN OUTSOURCING PERMIT IS ABOUT TWO COMPANIES. Principal_Licence_Number is the CEP licence of the OPERATOR WHO WILL HIRE THE APPLICANT — a third party — and Salesforce check it is active. The applicant must ALSO hold its own CEP licence, which is what requiresCepLicence means and is checked from their trade licence. Both, not either. If the applicant gives their own number as the principal's, say plainly that the principal is the company hiring them.

THREE PRODUCTS ARE ISSUED CONDITIONALLY. FOODMED and LOCKERS are followed by a physical inspection, INTERMED by a desk verification. Say so before they pay: the licence can be issued conditionally and an inspection follows. Never present approval as final where conditionalIssuance is true.

THE WEIGHT CEILING IS A REJECTION, NOT A WARNING. If declared_max_shipment_weight_kg is above the product's ceiling the application will be refused, so check it in the conversation and offer the product that does cover it.

DOCUMENTS. Only the slots whose condition holds are owed — do not ask for a document the chosen product does not require. Every slot's accepted formats and size limit are in the catalogue and they are NOT the same for every slot: a passport or an Emirates ID may be a PDF, a JPG or a PNG up to 10 MB and needs an expiry date, a Memorandum of Association may be any of the three up to 25 MB, and several of the others are PDF only. Read the slot, never assume PDF. A photo of an Emirates ID is acceptable — do not refuse one. Re-uploads after an information request go back through the SAME composite call.

A BIG FILE TAKES TWO CALLS. Above about 4 MB a document cannot travel as base64 inside the composite — Salesforce refuse the request outright. Upload it first with ${T}post_services_data_v60_0_sobjects_ContentVersion, then send the ordinary document item with EPG_File_Id__c set to the id that call returned and NO content. The same two steps work for re-uploading a rejected document. Below 4 MB, base64 inside the composite is still the simpler path.

AFTER SUBMISSION. ${T}get_services_apexrest_getApplicationStatus is the truth about an application: quote applicantStatus, and decision when it is present, in the customer's language — both are returned in English and Arabic, so never translate them yourself. ${T}get_services_apexrest_licensing_informationRequest says which documents must be re-uploaded and why; its documentsToReupload names each one with the reviewer's reason. A missing or unknown application now answers a real HTTP 404.

ONE WARNING ABOUT THEIR RESPONSE CODES. Their desc.code field reads RTA-S-0000 on failures as well as successes, so it cannot be used to tell them apart. Judge by the HTTP status and by the English text in desc, never by the code.

THE LICENCE ITSELF. Once it is issued, ${T}get_services_apexrest_licensing_licence returns it by application id, licence number or trade licence number, with validity dates and whether it was issued conditionally. Add includeDocument=true only when the customer actually wants the PDF — it is a few hundred kilobytes and most questions are answered without it.`;

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) { console.log(`${SLUG} is not on this database`); return; }
  const def = row.definition as any;
  const j = (def.journeys ?? []).find((x: any) => x.key === JOURNEY);
  if (!j) { console.log(`no ${JOURNEY} journey here`); return; }

  const text = String(j.guidance ?? "");
  const current = text.includes(MARKER);
  const hasOld = text.includes(OLD_MARKER);

  // Replace the 20 October block wholesale. Leaving it under the new one would
  // put "APPLICATIONID IS NOT SETTLED" in the same prompt as the rule that
  // settles it, and the model would have to choose.
  let guidance: string;
  if (current) {
    guidance = text;
  } else if (hasOld) {
    const start = text.indexOf(OLD_MARKER);
    const rest = text.slice(start);
    const sep = rest.indexOf("\n\n---\n\n");
    guidance = sep === -1 ? GUIDANCE : GUIDANCE + rest.slice(sep);
  } else {
    guidance = `${GUIDANCE}\n\n---\n\n${text}`;
  }

  const apiFlow = {
    service: "EPGL New Regulation",
    detailsTool: `${T}get_services_apexrest_licensing_catalogue`,
    pricingTool: `${T}post_services_apexrest_payment_pricing`,
    saveTool: `${T}post_services_apexrest_CompositeHandler`,
    statusTool: `${T}get_services_apexrest_getApplicationStatus`,
    informationRequestTool: `${T}get_services_apexrest_licensing_informationRequest`,
    uploadTool: `${T}post_services_data_v60_0_sobjects_ContentVersion`,
    licenceTool: `${T}get_services_apexrest_licensing_licence`,
    notes:
      "One Apex REST surface. Read the catalogue for the product's fields, documents and parameters; price with the pricing call and quote only what it returns; submit the composite; then poll status and the information request, and fetch the licence once it is issued. The composite is an Apex wrapper, NOT generic DML — its field names are handler aliases over real sObject fields, so send them exactly as the catalogue and the spec examples spell them and do not substitute sObject names. Salesforce mint the application id and return it as body.applicationId (LR-xxxxx); never send applicationId__c on a create, and use the returned id for every later call. Set isAgent_Request__c true on the application item. Documents are base64 inside the composite within each slot's own limit and accepted formats; above about 4 MB upload via ContentVersion first and reference it as EPG_File_Id__c with no content. A re-upload after an information request is the same composite call.",
  };

  console.log(`guidance: ${current ? "already at 2026-10-21" : hasOld ? `replacing the 2026-10-20 block (${GUIDANCE.length} chars)` : `+${GUIDANCE.length} chars prepended`}`);
  console.log(`apiFlow : ${Object.entries(apiFlow).filter(([k]) => k.endsWith("Tool")).length} tools (${apiFlow.uploadTool ? "upload + licence added" : ""})`);
  if (!APPLY) { console.log("\nDry run. Add --apply to write."); return; }

  j.guidance = guidance;
  j.submission = { ...(j.submission ?? {}), apiFlow };
  await db.update(agents).set({ definition: def as Record<string, unknown> as never }).where(eq(agents.id, row.id));
  console.log("\nwritten");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
