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
  "Before asking for any uploads, briefly tell the customer that the documents they submit are reviewed and verified by the EPGL team, so they should make sure the details are accurate and legible for the fastest processing (the panel shows this disclaimer above the upload slots too).";

const SIGNED_IN_PREFILL =
  "If the customer is SIGNED IN and a company profile is on file (see the known customer record note when present), use it: the account and company details and the owner's Emirates ID come from their Salesforce customer profile, and the quarterly leviable-income figures come from IDEP / company data. PREFILL these with collect_field and ask the customer only to confirm them (do NOT ask them to type values the profile already provides). Verify the Emirates ID looks valid (format 784-YYYY-NNNNNNN-N) and flag it if it does not. Only a signed-in customer gets this prefill; a guest continues documents-first.";

const CARDS_RULE =
  "Presentation: when you show captured details for confirmation, or a set of options to choose from, render them as a ```cards block in the chat (never a raw table dump). Keep the chat for the conversation and cards; the side panel already tracks what is still pending, so do not repeat long 'what is missing' checklists in the chat.";

const ISSUANCE_GUIDANCE = [
  "DOCUMENTS-FIRST. Do not interrogate the customer field by field. Instead:",
  DISCLAIMER_RULE,
  SIGNED_IN_PREFILL,
  "1) Ask the customer to upload their documents using the document slots in the panel: the Trade / Postal License, the Memorandum of Association (MOA), and the signed Declaration & Undertaking. The owner's Emirates ID is optional. On a phone they can use the camera; on a computer they can upload directly or scan the panel's QR code to upload from their phone.",
  "2) The system reads each uploaded document automatically and pre-fills the application (company name EN/AR, trade license number + dates, emirate, address, email, and the primary owner's name, nationality and passport come from the license and the MOA). Watch the case panel fill in.",
  "3) Once documents are in, show the customer what was captured as a card and ask them to confirm it is correct. Only ask the customer to type fields the documents did NOT provide (for example the activity codes, region, or a contact person if missing). NEVER ask for a value the case already shows.",
  "4) The Declaration & Undertaking is a legal consent form — treat its upload as the customer's acknowledgment; do not try to read data from it.",
  CARDS_RULE,
  "Then continue to duplicate-check and submission as before.",
].join("\n");

const RENEWAL_GUIDANCE = [
  "DOCUMENTS-FIRST, and prefer the signed-in customer's own data. Do not ask field by field. Instead:",
  DISCLAIMER_RULE,
  SIGNED_IN_PREFILL,
  "1) If signed in, confirm the company and license from their profile. Otherwise ask the customer to upload their current Trade / Postal License and the signed Declaration & Undertaking (and the quarterly financial statement if they have it). On a phone they can use the camera; on a computer they can upload directly or scan the panel's QR code to upload from their phone.",
  "2) The system reads the license and pre-fills the trade license number, expiry date and trade names automatically — watch the case panel.",
  "3) The quarterly leviable-income figures come from IDEP / company data for a signed-in customer — present them as a card for confirmation rather than asking the customer to enter them; only ask for figures that are genuinely missing, plus the accountant contact. Never re-ask for anything the license or profile already filled in.",
  "4) The Declaration & Undertaking upload is the customer's legal consent; do not extract data from it.",
  CARDS_RULE,
  "Then continue with the renewal submission (terms, finance summaries) as before.",
].join("\n");

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog not found");
  const def = agent.definition as Record<string, any>;

  def.documentsDisclaimer = DOCUMENTS_DISCLAIMER;
  const J = (key: string) => def.journeys.find((j: any) => j.key === key);
  const issuance = J("new_license");
  const renewal = J("renewal");
  if (!issuance || !renewal) throw new Error("expected new_license + renewal journeys");
  issuance.guidance = ISSUANCE_GUIDANCE;
  renewal.guidance = RENEWAL_GUIDANCE;

  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));
  console.log("EPGL Round-1 feedback applied:");
  console.log("  documentsDisclaimer set:", !!def.documentsDisclaimer);
  console.log("  new_license guidance:", issuance.guidance.length, "chars");
  console.log("  renewal guidance:", renewal.guidance.length, "chars");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
