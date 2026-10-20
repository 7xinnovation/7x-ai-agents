/**
 * EPGL 2.0: how the new-licence journey actually runs (20 October 2026).
 *
 * The 1.x apiFlow is twenty thousand characters describing the OLD composite —
 * record type ids, sobject urls, allOrNone fan-out. None of that is the New
 * Regulation surface, which is one Apex REST handler plus a catalogue, a
 * pricing call and a status call. Leaving both in the prompt would be asking
 * the model to pick, which is how the fifteen patchers in lib/integrations.ts
 * came to exist.
 *
 * So the apiFlow is REPLACED, and a 2.0 block is put at the top of the
 * guidance. The 1.x text below it is kept for the renewal journey's sake and
 * explicitly superseded for new licences.
 *
 * Idempotent (marker). Dry run by default. Run from apps/web:
 *   npx tsx scripts/epgl-2.0-guidance-2026-10-20.ts [--env <file>] [--apply]
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
export const MARKER = "EPGL 2.0 — NEW REGULATION (2026-10-20)";

const T = "epgl_new_regulation__";

export const GUIDANCE =
`${MARKER}. Everything in this block supersedes the older composite instructions further down, which describe the previous licensing API and apply only to renewals.

THE ORDER IS FIXED, AND THE PRODUCT COMES FIRST. Ask which licence or permit they want before anything else: every later question and every document depends on it. The moment they choose, set product_family yourself — CEP30 for any CEP30-* product, otherwise the product code — and set product_is_sme true when the code contains SME. Never ask for either; they are derived, and they are what the later questions are conditioned on.

THE PRICE COMES FROM THEM, NEVER FROM YOU. Call ${T}post_services_apexrest_payment_pricing and quote what it returns. Do not add, round, total or infer a fee, and do not read one out of the catalogue — the catalogue is what they may charge, the pricing call is what THIS application costs. It answers with line items, a currency, an invoice reference and an expiry; quote the items and say when the quote expires. Payment above the catalogue's onlinePaymentThresholdAed cannot be taken online — read that threshold from the catalogue, never hard-code it.

AN OUTSOURCING PERMIT IS ABOUT TWO COMPANIES. Principal_Licence_Number is the CEP licence of the OPERATOR WHO WILL HIRE THE APPLICANT — a third party — and Salesforce check it is active. The applicant must ALSO hold its own CEP licence, which is what requiresCepLicence means and is checked from their trade licence. Both, not either. If the applicant gives their own number as the principal's, say plainly that the principal is the company hiring them.

THREE PRODUCTS ARE ISSUED CONDITIONALLY. FOODMED and LOCKERS are followed by a physical inspection, INTERMED by a desk verification. Say so before they pay: the licence can be issued conditionally and an inspection follows. Never present approval as final where conditionalIssuance is true.

THE WEIGHT CEILING IS A REJECTION, NOT A WARNING. If declared_max_shipment_weight_kg is above the product's ceiling the application will be refused, so check it in the conversation and offer the product that does cover it.

DOCUMENTS. Only the slots whose condition holds are owed — do not ask for a document the chosen product does not require. Their limits come from the catalogue parameters (documentMaxSizeMb, and PDF only today); if a customer has a photo of an Emirates ID or passport, say we cannot accept it yet rather than letting the upload fail. Re-uploads after an information request go back through the SAME composite call.

AFTER SUBMISSION. ${T}get_services_apexrest_getApplicationStatus is the truth about an application: quote applicantStatus, and decision when it is present, in the customer's language — both are returned in English and Arabic, so never translate them yourself. ${T}get_services_apexrest_licensing_informationRequest says which documents must be re-uploaded and why. A missing application comes back as HTTP 200 with status 404 in the BODY, so read the body, not the HTTP code.

APPLICATIONID IS NOT SETTLED. Every one of their endpoints is keyed on it. Until Salesforce confirm who mints it, do not invent one, do not promise the customer a reference number of our making, and do not retry a submission that may already have landed — read the status first.`;

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) { console.log(`${SLUG} is not on this database`); return; }
  const def = row.definition as any;
  const j = (def.journeys ?? []).find((x: any) => x.key === JOURNEY);
  if (!j) { console.log(`no ${JOURNEY} journey here`); return; }

  const had = String(j.guidance ?? "").includes(MARKER);
  const guidance = had ? j.guidance : `${GUIDANCE}\n\n---\n\n${j.guidance ?? ""}`;
  const apiFlow = {
    service: "EPGL New Regulation",
    detailsTool: `${T}get_services_apexrest_licensing_catalogue`,
    pricingTool: `${T}post_services_apexrest_payment_pricing`,
    saveTool: `${T}post_services_apexrest_CompositeHandler`,
    statusTool: `${T}get_services_apexrest_getApplicationStatus`,
    informationRequestTool: `${T}get_services_apexrest_licensing_informationRequest`,
    notes:
      "One Apex REST surface. Read the catalogue for the product's fields, documents and parameters; price with the pricing call and quote only what it returns; submit the composite; then poll status and the information request. The composite is an Apex wrapper, NOT generic DML — its field names are handler aliases over real sObject fields, so send them exactly as the catalogue and the spec examples spell them and do not substitute sObject names. Documents are base64 inside the composite, PDF only, within the catalogue's documentMaxSizeMb. A re-upload after an information request is the same composite call.",
  };

  console.log(`guidance: ${had ? "already carries the 2.0 block" : `+${GUIDANCE.length} chars prepended`}`);
  console.log(`apiFlow : ${j.submission?.apiFlow?.service ?? "(none)"} -> ${apiFlow.service}`);
  console.log(`  tools : ${Object.entries(apiFlow).filter(([k]) => k.endsWith("Tool")).map(([k, v]) => `${k}=${String(v).replace(T, "")}`).join(", ")}`);
  if (!APPLY) { console.log("\nDry run. Add --apply to write."); return; }

  j.guidance = guidance;
  j.submission = { ...(j.submission ?? {}), apiFlow };
  await db.update(agents).set({ definition: def as Record<string, unknown> as never }).where(eq(agents.id, row.id));
  console.log("\nwritten");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
