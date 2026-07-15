/**
 * Applies the EPGL chatbot Round-1 feedback (feedback-export-2026-07-13.csv):
 *
 *   FB-1  Disclaimer before upload: documents are verified by the EPGL team; the
 *         customer must ensure accurate data for the fastest processing.
 *   FB-2  Renewal uses the signed-in user; the quarterly financial statement is
 *         pulled from IDEP / company data (not typed).
 *   FB-3  Account/company details + Emirates ID come from the signed-in
 *         customer's Salesforce profile and are verified for validity.
 *   FB-4  Use proper cards/displays in the chat; the side panel holds the checks
 *         of what is still pending.
 *
 * (FB-5 mobile view and FB-6 device-aware upload/QR are frontend changes, not
 * agent config — see Experience.tsx, globals.css and the /m mobile upload route.)
 *
 * The signed-in prefill is driven by the `customerContext` the chat route injects
 * for a signed-in EPGL user (knownEpglProfile). This script only updates the
 * agent's disclaimer + per-journey guidance so the model uses it.
 *
 * Run: npx tsx scripts/apply-epgl-round1-feedback.ts   (from apps/web)
 *   prod: DATABASE_URL=<Railway Postgres DATABASE_PUBLIC_URL> npx tsx scripts/apply-epgl-round1-feedback.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const DOCUMENTS_DISCLAIMER = {
  en: "Documents you upload are reviewed and verified by the EPGL team. Please make sure every detail is accurate and legible so your application is completed with the fewest follow-ups.",
  ar: "تتم مراجعة المستندات التي ترفعها والتحقق منها من قبل فريق مجموعة بريد الإمارات. يرجى التأكد من دقة ووضوح جميع البيانات حتى يكتمل طلبك بأقل عدد من المتابعات.",
};

// Shared conversational rules appended to both EPGL journeys.
const DISCLAIMER_RULE =
  "Before asking for any uploads, briefly tell the customer that the documents they submit are reviewed and verified by the EPGL team, so they should make sure the details are accurate and legible for the fastest processing.";

// Uploads happen INSIDE the chat, one document at a time (feedback).
const UPLOAD_RULE =
  "Collect documents ONE AT A TIME, inside the chat. To request a document, emit a fenced upload block: a line with three backticks followed by the word `upload`, then a line `key: <documentKey>`, then a closing line of three backticks. That renders an upload control right in the conversation (the customer can pick a file, take a photo on mobile, or scan a QR to upload from their phone). Ask for exactly ONE document per turn: introduce it in one short sentence, emit its single ```upload block, and STOP. Wait for the customer to upload it. Once it is uploaded the system reads it and pre-fills the case; briefly confirm what was captured, then request the NEXT document the same way. Never list several documents at once, never emit more than one upload block in a message, and never tell the customer to use a side panel.";

const SIGNED_IN_PREFILL =
  "If the customer is SIGNED IN and a company profile is on file (see the known customer record note when present), use it: the account and company details and the owner's Emirates ID come from their Salesforce customer profile, and the quarterly leviable-income figures come from IDEP / company data. PREFILL these with collect_field and ask the customer only to confirm them (do NOT ask them to type values the profile already provides). Verify the Emirates ID looks valid (format 784-YYYY-NNNNNNN-N) and flag it if it does not. Only a signed-in customer gets this prefill; a guest continues documents-first.";

// Never re-ask for anything the documents already carry or that duplicates
// another captured field (feedback: if we have it in any doc, do not ask again).
const NO_REDUNDANT_ASK =
  "NEVER ask the customer for a value that any uploaded document already provides, or that duplicates a value already captured. In particular: the REGION / area and the POSTAL ACTIVITY CODE(S) are on the Trade / Postal License, so take them from there; the OWNER CONTACT NUMBER is the same as the contact phone, so set owner_contact_no to the contact_phone value with collect_field and do not ask for it separately. After each upload, re-read the captured case data and only ask for fields that are genuinely absent from every document AND cannot be derived from another field. When you do have to ask, ask only for those truly-missing fields, one clear question at a time.";

const CARDS_RULE =
  "Presentation: when you show captured details for confirmation, or a set of options to choose from, render them as a ```cards block in the chat (never a raw table dump). Keep the chat for the conversation and cards; the side panel already tracks what is still pending, so do not repeat long 'what is missing' checklists in the chat.";

const ISSUANCE_GUIDANCE = [
  "DOCUMENTS-FIRST. Do not interrogate the customer field by field. Instead:",
  DISCLAIMER_RULE,
  SIGNED_IN_PREFILL,
  UPLOAD_RULE,
  "1) Collect the documents one at a time, in this order, each with its own ```upload block (document keys in brackets): first the Trade / Postal License (key: trade_license), then the Memorandum of Association (key: moa), then the signed Declaration and Undertaking (key: commitment_form). The owner's Emirates ID (key: emirates_id) is OPTIONAL: offer it last, only if the customer wants to add it.",
  "2) The system reads each uploaded document automatically and pre-fills the application (company name EN/AR, trade license number and dates, emirate, address, email, and the primary owner's name, nationality and passport come from the license and the MOA).",
  "3) After each upload, briefly confirm what was captured, then request the next document. Once all documents are in, show a short ```cards summary of the captured details and ask the customer to confirm.",
  NO_REDUNDANT_ASK,
  "4) The Declaration and Undertaking is a legal consent form: treat its upload as the customer's acknowledgment; do not try to read data from it.",
  CARDS_RULE,
  "Then continue to duplicate-check and submission as before.",
].join("\n");

const RENEWAL_GUIDANCE = [
  "DOCUMENTS-FIRST, and prefer the signed-in customer's own data. Do not ask field by field. Instead:",
  DISCLAIMER_RULE,
  SIGNED_IN_PREFILL,
  UPLOAD_RULE,
  "1) If signed in, confirm the company and license from their profile first. Then collect the documents one at a time, each with its own ```upload block: the current Trade / Postal License (key: updated_trade_license), then the signed Declaration and Undertaking (key: commitment_form). The quarterly financial statement (key: financial_statement) is OPTIONAL: offer it if they have it.",
  "2) The system reads the license and pre-fills the trade license number, expiry date and trade names automatically.",
  "3) The quarterly leviable-income figures come from IDEP / company data for a signed-in customer: present them as a ```cards summary for confirmation rather than asking the customer to enter them; only ask for figures that are genuinely missing, plus the accountant contact.",
  NO_REDUNDANT_ASK,
  "4) The Declaration and Undertaking upload is the customer's legal consent; do not extract data from it.",
  CARDS_RULE,
  "Then continue with the renewal submission (terms, finance summaries) as before.",
].join("\n");

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog not found");
  const def = agent.definition as Record<string, any>;

  def.documentsDisclaimer = DOCUMENTS_DISCLAIMER;
  def.documentsInChat = true; // uploads happen inline in the chat, one at a time
  const J = (key: string) => def.journeys.find((j: any) => j.key === key);
  const issuance = J("new_license");
  const renewal = J("renewal");
  if (!issuance || !renewal) throw new Error("expected new_license + renewal journeys");
  issuance.guidance = ISSUANCE_GUIDANCE;
  renewal.guidance = RENEWAL_GUIDANCE;

  // Salesforce composite rule (fixes "Invalid or missing URL" on submit/update):
  // every compositeRequest item must carry method + referenceId + a url pointing
  // at the object's sobjects path. Appended to both journeys' apiFlow notes.
  const COMPOSITE_URL_RULE =
    " CRITICAL COMPOSITE RULE: EVERY item in compositeRequest MUST include (a) method:'POST', (b) a referenceId, and (c) a url set to the object's sobjects path. Use exactly these urls: Account -> /services/data/v66.0/sobjects/Account; EPG_Partner__c -> /services/data/v66.0/sobjects/EPG_Partner__c; Contact -> /services/data/v66.0/sobjects/Contact; User -> /services/data/v66.0/sobjects/User; Members__c -> /services/data/v66.0/sobjects/Members__c; EPG_Document__c -> /services/data/v66.0/sobjects/EPG_Document__c; EPG_License_Request__c -> /services/data/v66.0/sobjects/EPG_License_Request__c; EPG_Finance_Summary__c -> /services/data/v66.0/sobjects/EPG_Finance_Summary__c. A subrequest without a valid url fails the ENTIRE submit with 'Invalid or missing URL'. This applies identically to new submissions AND updates. For an UPDATE, first call epglsalesforce__duplicateCheck (or getRequestStatus) to obtain the existing Account Id and License Request Name, put them in the Account.Id / EPG_License_Request__c.Name fields, and still include every item's url as above.";
  for (const j of [issuance, renewal]) {
    const af = j.submission?.apiFlow;
    if (af && !((af.notes ?? "").includes("CRITICAL COMPOSITE RULE"))) af.notes = (af.notes ?? "") + COMPOSITE_URL_RULE;
  }

  // Owner contact number duplicates the contact phone — never require it or block
  // submission on it; the agent copies contact_phone into it (see NO_REDUNDANT_ASK).
  let tweaked = 0;
  for (const j of def.journeys)
    for (const s of j.steps ?? [])
      for (const f of s.fields ?? [])
        if (f.key === "owner_contact_no" && f.validation?.required) {
          f.validation.required = false;
          tweaked++;
        }

  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));
  console.log("  owner_contact_no made optional on", tweaked, "step(s)");
  console.log("EPGL Round-1 feedback applied:");
  console.log("  documentsDisclaimer set:", !!def.documentsDisclaimer);
  console.log("  documentsInChat:", def.documentsInChat);
  console.log("  new_license guidance:", issuance.guidance.length, "chars");
  console.log("  renewal guidance:", renewal.guidance.length, "chars");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
