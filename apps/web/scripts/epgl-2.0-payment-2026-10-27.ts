/**
 * EPGL 2.0: how the licence fee is actually taken (27 Oct 2026).
 *
 * Payment was the last thing on the 2.0 list that nobody could do, and it was
 * never ours: "blocked on EPGL's gateway -> PaymentNotification". Salesforce
 * answered on 27 October, and the answer was that nothing was missing from
 * their side either — two steps were missing from the PACK.
 *
 *   1. The applicant is ready to pay -> the composite again, with the
 *      application id, its Product_Code and EPG_Request_Status__c =
 *      "Pending Payment". THAT is what raises the payment advice.
 *   2. Price again. refInvoiceId is now the advice number and the items are
 *      what to charge.
 *   3. Take the money on our gateway, as before.
 *   4. POST /services/apexrest/paymentNotification. Salesforce marks the advice
 *      paid, SUBMITS the application itself, runs the pre-checks, and pushes
 *      payment.updated and status.changed to our endpoint.
 *
 * Confirmed against their sandbox on 27 October without writing anything to it:
 * LR-54066, still in Draft, prices at AED 1,000 with refInvoiceId null, while
 * LR-54056, which Salesforce ran through payment themselves, prices at the same
 * 1,000 with refInvoiceId "P14226" and quotationStatus "Paid". Their
 * PaymentNotification class marks transactions[0] of the licence request Paid —
 * so with no advice raised there is nothing to mark, and the call answers 200
 * having done nothing. That is the failure this guidance exists to prevent, and
 * it is why steps 1, 2 and 4 are SERVER-side (lib/epgl20Payment.ts) rather than
 * three more things for the model to remember.
 *
 * What the model is told here is therefore mostly what NOT to do: do not move
 * the status, do not compose an amount, and do not submit anything after the
 * payment — their paid-advice hook does that, and a second composite would be a
 * second application's worth of noise on a request already in flight.
 *
 * Replaces the 21 October block by marker, for the same reason that one
 * replaced the 20th's: two blocks of guidance about one subject is the failure,
 * not the fix.
 *
 * AND IT PUTS submitBeforePayment BACK, without which none of the above can
 * run at all. The 21 October script rewrote the journey's apiFlow wholesale and
 * its replacement omitted the flag, which does two things at once:
 *
 *   - The rendered numbered steps flip to "call request_payment, THEN call the
 *     save tool" — pay first, create the application after. On 2.0 that takes
 *     the money against no application and therefore no advice, which is the
 *     exact failure the comment above those lines in prompt.ts was written for.
 *   - The composite joins `unpaidSaveTools` in the chat route and is refused
 *     until the case is paid. So the application cannot be created before the
 *     payment, and the payment cannot be raised without the application. The
 *     deadlock is described at the top of that filter; this is it, live.
 *
 * Neither shows up as an error. The first charges the applicant twice the fee
 * (the journey's 1,000 plus the gateway surcharge) for an application still in
 * Draft; the second looks like the assistant refusing to submit.
 *
 * Idempotent. Dry run by default. Run from apps/web:
 *   npx tsx scripts/epgl-2.0-payment-2026-10-27.ts [--env <file>] [--apply]
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
export const MARKER = "EPGL 2.0 — NEW REGULATION (2026-10-27)";
/** The blocks this replaces, newest first. Written out rather than imported:
 *  those modules call main() at the top level. */
const OLD_MARKERS = [
  "EPGL 2.0 — NEW REGULATION (2026-10-21)",
  "EPGL 2.0 — NEW REGULATION (2026-10-20)",
];

const T = "epgl_new_regulation__";

export const GUIDANCE =
`${MARKER}. Everything in this block supersedes the older composite instructions further down, which describe the previous licensing API and apply only to renewals.

THE ORDER IS FIXED, AND THE PRODUCT COMES FIRST. Ask which licence or permit they want before anything else: every later question and every document depends on it. The moment they choose, set product_family yourself — CEP30 for any CEP30-* product, otherwise the product code — and set product_is_sme true when the code contains SME. Never ask for either; they are derived, and they are what the later questions are conditioned on.

THE APPLICATION NUMBER IS THEIRS TO ISSUE, NOT OURS. Never send applicationId__c when creating an application — an id Salesforce did not mint is rejected. The create response carries it back as body.applicationId on the NewLicenseRequest item, in the form LR-xxxxx, and THAT is the number the customer quotes and the key for every later call: documents, pricing, status, information requests and the licence. Do not invent a reference, and do not give the customer one before the create has answered.

A SUBMISSION THAT MAY HAVE LANDED IS SAFE TO SEND AGAIN. If a create times out, re-sending the same application returns the application that already exists rather than making a second one — confirmed against their sandbox. So a timeout is not a reason to leave the customer without a number: send it again and read the id off the answer.

SAY IT CAME THROUGH THE ASSISTANT. Set isAgent_Request__c true on the application item on every submission made here. Emirates Post use it to tell an assistant application from a portal one, and it comes back as agentRequest on the status call.

THE PRICE COMES FROM THEM, NEVER FROM YOU. Call ${T}post_services_apexrest_payment_pricing and quote what it returns. Do not add, round, total or infer a fee, and do not read one out of the catalogue — the catalogue is what they may charge, the pricing call is what THIS application costs. It answers with line items, a currency, an invoice reference and an expiry; quote the items and say when the quote expires. Payment above the catalogue's onlinePaymentThresholdAed cannot be taken online — read that threshold from the catalogue, never hard-code it.

PAYING IS FOUR STEPS AND ONLY ONE OF THEM IS YOURS. When the applicant is ready to pay, call request_payment and nothing else. Behind it the server moves the application to Pending Payment — which is what makes Salesforce raise the payment advice — reads the advice and its amount back from the pricing call, and opens the card for exactly that figure. Do NOT move the status yourself, do NOT send a composite to do it, and do NOT pass an amount you worked out or remembered: the card charges what Emirates Post have just invoiced, and any other number leaves an invoice that can never be settled.

NOTHING OF YOURS SUBMITS THE APPLICATION TO EMIRATES POST. On the new regulation the paid advice submits it and starts the pre-checks — Salesforce does that by itself, the moment the payment is reported. So after the payment do NOT send another composite, and do not tell the applicant you are now submitting their application: it went to Emirates Post when they paid. Do still call submit_case once the payment reads paid — that closes the case on our side and is where their reference comes from — but it files nothing with Emirates Post and must never be described as if it did.

THE ONLINE PAYMENT FEE NAMED FURTHER DOWN IS NOT THIS LICENCE'S. That gateway surcharge belongs to the previous licensing service. A new-regulation application is charged exactly what the pricing call quotes, with nothing added, so never quote a card total higher than the quoted fee.

IF THE FEE CANNOT BE TAKEN, NOTHING HAS BEEN CHARGED. request_payment may answer that Emirates Post could not raise the invoice for this application. That is not a failed payment and it is not the applicant's fault: say plainly that the fee cannot be taken this minute, offer to try again shortly or to arrange a callback, and never offer them another way to pay or a link of any kind.

AN OUTSOURCING PERMIT IS ABOUT TWO COMPANIES. Principal_Licence_Number is the CEP licence of the OPERATOR WHO WILL HIRE THE APPLICANT — a third party — and Salesforce check it is active. The applicant must ALSO hold its own CEP licence, which is what requiresCepLicence means and is checked from their trade licence. Both, not either. If the applicant gives their own number as the principal's, say plainly that the principal is the company hiring them.

THREE PRODUCTS ARE ISSUED CONDITIONALLY. FOODMED and LOCKERS are followed by a physical inspection, INTERMED by a desk verification. Say so before they pay: the licence can be issued conditionally and an inspection follows. Never present approval as final where conditionalIssuance is true.

THE WEIGHT CEILING IS A REJECTION, NOT A WARNING. If declared_max_shipment_weight_kg is above the product's ceiling the application will be refused, so check it in the conversation and offer the product that does cover it.

DOCUMENTS. Only the slots whose condition holds are owed — do not ask for a document the chosen product does not require. Every slot's accepted formats and size limit are in the catalogue and they are NOT the same for every slot: a passport or an Emirates ID may be a PDF, a JPG or a PNG up to 10 MB and needs an expiry date, a Memorandum of Association may be any of the three up to 25 MB, and several of the others are PDF only. Read the slot, never assume PDF. A photo of an Emirates ID is acceptable — do not refuse one. Re-uploads after an information request go back through the SAME composite call.

A BIG FILE TAKES TWO CALLS. Above about 4 MB a document cannot travel as base64 inside the composite — Salesforce refuse the request outright. Upload it first with ${T}post_services_data_v60_0_sobjects_ContentVersion, then send the ordinary document item with EPG_File_Id__c set to the id that call returned and NO content. The same two steps work for re-uploading a rejected document. Below 4 MB, base64 inside the composite is still the simpler path.

AFTER SUBMISSION. ${T}get_services_apexrest_getApplicationStatus is the truth about an application: quote applicantStatus, and decision when it is present, in the customer's language — both are returned in English and Arabic, so never translate them yourself. ${T}get_services_apexrest_licensing_informationRequest says which documents must be re-uploaded and why; its documentsToReupload names each one with the reviewer's reason. A missing or unknown application now answers a real HTTP 404.

ONE WARNING ABOUT THEIR RESPONSE CODES. Their desc.code field reads RTA-S-0000 on failures as well as successes, so it cannot be used to tell them apart. Judge by the HTTP status and by the English text in desc, never by the code.

THE LICENCE ITSELF. Once it is issued, ${T}get_services_apexrest_licensing_licence returns it by application id, licence number or trade licence number, with validity dates and whether it was issued conditionally. Add includeDocument=true only when the customer actually wants the PDF — it is a few hundred kilobytes and most questions are answered without it.`;

/**
 * Swap this agent's 2.0 block for a new one, keeping everything around it.
 *
 * AROUND IT, not after it — and that word cost 4,047 characters of live
 * guidance on 27 October. The 20 and 21 October scripts both wrote
 * `text.slice(text.indexOf(old))` and kept only what followed the separator,
 * which is correct exactly while the 2.0 block is the FIRST thing in the text.
 * It stopped being first on 22 October, when the values block was prepended in
 * front of it; this script inherited the line, ran, and took the values block
 * with it — the product codes, the object names, the "do not guess again" rule.
 * Restored by re-running epgl-2.0-values-2026-10-22.ts, which rebuilds it from
 * the pinned catalogue, so nothing was lost for good. The lesson is cheaper
 * than the incident: a replacement keeps BOTH sides.
 */
export function replaceBlock(text: string, guidance: string, marker: string, oldMarkers: readonly string[]): string {
  // The block THIS script owns is replaced whether it is already under our own
  // marker or still under a previous one. "Marker present, so nothing to do"
  // looks idempotent and is not: a correction made to the text on the same day
  // reports success and writes nothing, which is how the first version of this
  // paragraph — the one that told the model to skip submit_case and strand the
  // case — stayed live through a run that said it had been applied.
  const target = text.includes(marker) ? marker : oldMarkers.find((m) => text.includes(m));
  if (!target) return `${guidance}\n\n---\n\n${text}`;
  const at = text.indexOf(target);
  const before = text.slice(0, at);
  const rest = text.slice(at);
  const sep = rest.indexOf("\n\n---\n\n");
  return before + (sep === -1 ? guidance : guidance + rest.slice(sep));
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) { console.log(`${SLUG} is not on this database`); return; }
  const def = row.definition as any;
  const j = (def.journeys ?? []).find((x: any) => x.key === JOURNEY);
  if (!j) { console.log(`no ${JOURNEY} journey here`); return; }

  const text = String(j.guidance ?? "");
  const current = text.includes(MARKER);
  const old = OLD_MARKERS.find((m) => text.includes(m));
  const guidance = replaceBlock(text, GUIDANCE, MARKER, OLD_MARKERS);
  const unchanged = guidance === text;

  console.log(
    `guidance: ${unchanged ? "unchanged" : current ? "updating the 2026-10-27 block in place" : old ? `replacing the ${old.slice(-11, -1)} block` : "prepended"}` +
      ` (${GUIDANCE.length} chars, text ${text.length} -> ${guidance.length})`
  );
  // The payment paragraphs are the point of this run; say whether they landed.
  for (const probe of ["PAYING IS FOUR STEPS", "NOTHING OF YOURS SUBMITS THE APPLICATION", "Do still call submit_case", "IF THE FEE CANNOT BE TAKEN"]) {
    console.log(`  ${guidance.includes(probe) ? "ok  " : "MISSING"} ${probe}`);
  }
  console.log(`apiFlow : submitBeforePayment ${j.submission?.apiFlow?.submitBeforePayment === true ? "already true" : "FALSE -> true"}`);
  const fee = (j.submission?.surcharges ?? []).find((x: any) => x?.key === "online_payment_fee");
  console.log(`fees    : online_payment_fee ${fee ? `present (${fee.amount}) -> removed` : "already gone"}`);
  if (!APPLY) { console.log("\nDry run. Add --apply to write."); return; }

  j.guidance = guidance;
  j.submission = {
    ...(j.submission ?? {}),
    apiFlow: { ...(j.submission?.apiFlow ?? {}), submitBeforePayment: true },
    /**
     * THE CARD CHARGES THE INVOICE, SO IT MUST NOT QUOTE ANYTHING ELSE.
     *
     * The gateway surcharge is a 1.x arrangement: AED 1,000 on top of the
     * 100,000 licence fee, disclosed on the payment option and added by
     * request_payment. On 2.0 the amount comes from the advice Salesforce
     * raises, which outranks the journey's figure — so the first real run
     * offered the applicant "Pay with Card — AED 2,000" and would have charged
     * 1,000. A quote that is not the charge is the bug we have fixed twice
     * already from the other direction.
     *
     * Both halves could be made to agree the other way instead: charge 2,000
     * and report 2,000, which is what 1.x does against its 100,000 advice. That
     * is EPGL's call, not ours, and until they make it the applicant is quoted
     * exactly what Emirates Post have invoiced. One line to put back.
     */
    surcharges: (j.submission?.surcharges ?? []).filter((x: any) => x?.key !== "online_payment_fee"),
  };
  await db.update(agents).set({ definition: def as Record<string, unknown> as never }).where(eq(agents.id, row.id));
  console.log("\nwritten");
}
/**
 * Only when it is the thing being run.
 *
 * Every one of these scripts calls main() at the top level, which is why the
 * 20 and 21 October blocks had to be copied into their successors rather than
 * imported from them — reading one constant would run the whole script. The
 * test imports replaceBlock from here, so this one does not do that.
 */
if (process.argv[1]?.includes("epgl-2.0-payment-2026-10-27")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
