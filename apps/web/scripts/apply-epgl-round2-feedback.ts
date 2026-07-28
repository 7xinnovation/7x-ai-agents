/**
 * Applies the EPGL chatbot Round-2 feedback (Feedback.pptx, 2026-07-21):
 *
 *   Slide 1  New license: full Arabic (no English leaks — see Experience.tsx /
 *            prompt.ts code changes), and ask ONLY for the Trade License — a new
 *            applicant has no postal license yet, so the "Trade / Postal License"
 *            wording and option must not appear.
 *   Slide 2  Declaration & Undertaking becomes an in-chat acknowledgment
 *            CHECKBOX (it is already a checkbox in Salesforce): no download,
 *            sign, or upload. Acceptance is recorded with date+time
 *            (declaration_accepted_at, stamped server-side in tools.ts) and
 *            submitted with the application.
 *   Slide 3  Emirates ID: manual entry OR upload (customer's choice); an
 *            uploaded expired EID is detected and rejected (upload route).
 *   Slide 4  "Your case" → "Your application" (Experience.tsx), and renewals
 *            display the postal license number (new field + guidance).
 *
 * Run: npx tsx scripts/apply-epgl-round2-feedback.ts   (from apps/web)
 *   prod: DATABASE_URL=<Railway Postgres DATABASE_PUBLIC_URL> npx tsx scripts/apply-epgl-round2-feedback.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

type L = { en: string; ar: string };
const t = (en: string, ar: string): L => ({ en, ar });
const doc = (key: string, en: string, ar: string, requirement: "mandatory" | "optional" = "mandatory") => ({
  key, label: t(en, ar), requirement, acceptedFormats: ["pdf", "png", "jpg"], maxSizeMb: 10,
});
const field = (key: string, en: string, ar: string, type = "text", required = true) => ({
  key, label: t(en, ar), type, validation: { required },
});

// ── Shared conversational rules (round 1 kept, round 2 added) ────────────────

const DISCLAIMER_RULE =
  "Before asking for any uploads, briefly tell the customer that the documents they submit are reviewed and verified by the EPGL team, so they should make sure the details are accurate and legible for the fastest processing.";

const UPLOAD_RULE =
  "Collect documents ONE AT A TIME, inside the chat. To request a document, emit a fenced upload block: a line with three backticks followed by the word `upload`, then a line `key: <documentKey>`, then a closing line of three backticks. That renders an upload control right in the conversation (the customer can pick a file, take a photo on mobile, or scan a QR to upload from their phone). Ask for exactly ONE document per turn: introduce it in one short sentence, emit its single ```upload block, and STOP. Wait for the customer to upload it. Once it is uploaded the system reads it and pre-fills the case; briefly confirm what was captured, then request the NEXT document the same way. Never list several documents at once, never emit more than one upload block in a message, and never tell the customer to use a side panel.";

const SIGNED_IN_PREFILL =
  "If the customer is SIGNED IN and a company profile is on file (see the known customer record note when present), use it: the account and company details and the owner's Emirates ID come from their Salesforce customer profile, and the quarterly leviable-income figures come from IDEP / company data. PREFILL these with collect_field and ask the customer only to confirm them (do NOT ask them to type values the profile already provides). Verify the Emirates ID looks valid (format 784-YYYY-NNNNNNN-N) and flag it if it does not. Only a signed-in customer gets this prefill; a guest continues documents-first.";

const NO_REDUNDANT_ASK =
  "NEVER ask the customer for a value that any uploaded document already provides, or that duplicates a value already captured. In particular: the REGION / area and the POSTAL ACTIVITY CODE(S) are on the Trade License, so take them from there; the OWNER CONTACT NUMBER is the same as the contact phone, so set owner_contact_no to the contact_phone value with collect_field and do not ask for it separately. After each upload, re-read the captured case data and only ask for fields that are genuinely absent from every document AND cannot be derived from another field. When you do have to ask, ask only for those truly-missing fields, one clear question at a time.";

const CARDS_RULE =
  "Presentation: when you show captured details for confirmation, or a set of options to choose from, render them as a ```cards block in the chat (never a raw table dump). Keep the chat for the conversation and cards; the side panel already tracks what is still pending, so do not repeat long 'what is missing' checklists in the chat.";

// Slide 1 + general: no English may leak into an Arabic session (or vice versa).
const LANGUAGE_RULE =
  "LANGUAGE: write EVERYTHING in the session language — the prose AND every label inside ```buttons, ```cards, ```toggles and ```summary blocks (titles, badges, descs, toggle labels, confirm buttons). In an Arabic session no English UI text may ever appear in your messages (and no Arabic in an English session). A customer tapping a button whose label is in the other language, or a document being written in the other language, is NOT a language switch: keep the session language.";

// Slide 2: the Declaration & Undertaking is an in-chat checkbox, never an upload.
const DECLARATION_RULE =
  "DECLARATION & UNDERTAKING — IN-CHAT CHECKBOX, NEVER AN UPLOAD: do not ask the customer to download, sign, scan or upload any declaration document. After the documents are collected (and before submission), present the Declaration and Undertaking as an acknowledgment checkbox: first summarise in one or two plain sentences what the customer is declaring (that the information provided is accurate and that they accept EPGL's postal licensing terms and undertakings), then emit a ```toggles block with `style: checkbox`, a `title:`, one line `- declaration_accepted: <'I have read and agree to the Declaration and Undertaking' in the session language>`, and a `confirm:` button label. Only when the customer ticks the box and confirms, call collect_field with declaration_accepted = true — the system automatically records the acceptance DATE AND TIME as declaration_accepted_at, and both are stored on the application and carried into the Salesforce submission. If the customer declines, explain the application cannot be submitted without this acknowledgment.";

// Slide 3: Emirates ID by manual entry OR upload; expired cards are rejected.
const EMIRATES_ID_RULE =
  "OWNER EMIRATES ID — THE CUSTOMER CHOOSES HOW: the Emirates ID can be provided either by TYPING the number or by UPLOADING the card. When you reach it (and the MOA/profile did not already provide the number), offer both in one short message with a ```buttons block (two options in the session language: upload the Emirates ID / type the number). If they choose upload, emit ```upload with key: emirates_id; the system reads the card, fills the ID number automatically, and CHECKS THE EXPIRY DATE — an EXPIRED card is rejected automatically with the reason on the upload widget: explain it plainly and ask for a valid (unexpired) card or the typed number of a valid card. If they type it, validate the 784-YYYY-NNNNNNN-N format. If the number is already on file or was read from the MOA, just confirm it instead of asking again.";

const ISSUANCE_GUIDANCE = [
  "DOCUMENTS-FIRST. Do not interrogate the customer field by field. Instead:",
  DISCLAIMER_RULE,
  SIGNED_IN_PREFILL,
  UPLOAD_RULE,
  "1) Collect the documents one at a time, in this order, each with its own ```upload block: first the TRADE LICENSE (key: trade_license) — this is a NEW postal activity license application, so the customer has NO postal license yet: ask only for the Trade License and NEVER call it 'Trade / Postal License' or mention a postal license upload — then the Memorandum of Association (key: moa).",
  "2) The system reads each uploaded document automatically and pre-fills the application (company name EN/AR, trade license number and dates, emirate, address, email, and the primary owner's name, nationality and passport come from the license and the MOA).",
  "3) After each upload, briefly confirm what was captured, then continue. After the two documents are in: " + EMIRATES_ID_RULE,
  "4) " + DECLARATION_RULE,
  "5) Once documents, Emirates ID and the declaration are done, show a short ```cards summary of the captured details and ask the customer to confirm.",
  NO_REDUNDANT_ASK,
  CARDS_RULE,
  LANGUAGE_RULE,
  "Then continue to duplicate-check and submission as before.",
].join("\n");

const RENEWAL_GUIDANCE = [
  "DOCUMENTS-FIRST, and prefer the signed-in customer's own data. Do not ask field by field. Instead:",
  DISCLAIMER_RULE,
  SIGNED_IN_PREFILL,
  "POSTAL LICENSE NUMBER: a renewal renews an EXISTING postal activity license, so capture and display its number EARLY: take postal_license_number from the signed-in profile or a duplicate-check / status lookup when available, otherwise ask the customer for it once at the start, and record it with collect_field so it shows in the application panel.",
  UPLOAD_RULE,
  "1) If signed in, confirm the company and license from their profile first. Then collect the current Trade / Postal License (key: updated_trade_license) with its ```upload block. The quarterly financial statement (key: financial_statement) is OPTIONAL: offer it if they have it.",
  "2) The system reads the license and pre-fills the trade license number, expiry date and trade names automatically.",
  "3) The quarterly leviable-income figures come from IDEP / company data for a signed-in customer: present them as a ```cards summary for confirmation rather than asking the customer to enter them; only ask for figures that are genuinely missing, plus the accountant contact.",
  "4) " + DECLARATION_RULE + " For renewal, the same checkbox block must carry a SECOND line `- terms_accepted: <'I accept the terms and conditions and the mandatory IDEP integration' in the session language>` so both acknowledgments are captured together (both are recorded with date and time).",
  NO_REDUNDANT_ASK,
  CARDS_RULE,
  LANGUAGE_RULE,
  "Then continue with the renewal submission (terms, finance summaries) as before.",
].join("\n");

// Salesforce mapping for the in-chat acceptance (appended to apiFlow notes).
const ISSUANCE_SF_DECLARATION_NOTE =
  " DECLARATION MAPPING: the Declaration & Undertaking is captured in-chat as declaration_accepted (with the acceptance date+time in declaration_accepted_at — both are on the case). On the EPG_License_Request__c include Terms_Conditions_Accepted__c: true when declaration_accepted is true. Never ask for a signed/uploaded declaration document.";
const RENEWAL_SF_DECLARATION_NOTE =
  " DECLARATION MAPPING: the Declaration & Undertaking and terms/IDEP acknowledgments are captured in-chat as declaration_accepted and terms_accepted (each with its _at acceptance date+time on the case). They are what authorises EPG_Terms_and_Conditions__c, Approved_Commitment_Form__c, Mandatory_integration_with_IDEP__c and Terms_Conditions_Accepted__c = true on the submission — only set those true when the checkboxes were confirmed. Never ask for a signed/uploaded declaration document.";

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog not found");
  const def = agent.definition as Record<string, any>;
  const J = (key: string) => def.journeys.find((j: any) => j.key === key);
  const issuance = J("new_license");
  const renewal = J("renewal");
  if (!issuance || !renewal) throw new Error("expected new_license + renewal journeys");

  // ── Slide 1: new license asks for the Trade License only (no postal option). ──
  const issuanceDocsStep = issuance.steps.find((s: any) => s.documents?.length);
  issuanceDocsStep.documents = [
    doc("trade_license", "Trade License", "الرخصة التجارية"),
    doc("moa", "Memorandum of Association (MOA)", "عقد التأسيس"),
    // Slide 3: EID stays optional as a document — the number can be typed instead.
    doc("emirates_id", "Owner Emirates ID", "الهوية الإماراتية للمالك", "optional"),
    // Slide 2: commitment_form upload removed — replaced by the checkbox below.
  ];

  // ── Slide 2: declaration acknowledgment checkbox fields (new license). ──
  issuanceDocsStep.fields = [
    field("declaration_accepted", "Declaration & Undertaking accepted", "الموافقة على الإقرار والتعهد", "boolean"),
    field("declaration_accepted_at", "Declaration accepted at (date & time, UTC)", "تاريخ ووقت قبول الإقرار والتعهد (UTC)", "text", false),
  ];
  issuance.guidance = ISSUANCE_GUIDANCE;
  if (issuance.submission?.apiFlow && !issuance.submission.apiFlow.notes?.includes("DECLARATION MAPPING"))
    issuance.submission.apiFlow.notes = (issuance.submission.apiFlow.notes ?? "") + ISSUANCE_SF_DECLARATION_NOTE;

  // ── Renewal: drop the commitment_form upload, add checkbox + timestamps. ──
  const renewalDocsStep = renewal.steps.find((s: any) => s.documents?.length);
  renewalDocsStep.documents = renewalDocsStep.documents.filter((d: any) => d.key !== "commitment_form");
  renewalDocsStep.fields = [
    field("declaration_accepted", "Declaration & Undertaking accepted", "الموافقة على الإقرار والتعهد", "boolean"),
    field("declaration_accepted_at", "Declaration accepted at (date & time, UTC)", "تاريخ ووقت قبول الإقرار والتعهد (UTC)", "text", false),
  ];

  // ── Slide 4: renewals display the postal license number. ──
  const reviewStep = renewal.steps.find((s: any) => s.key === "license_review") ?? renewal.steps[1];
  if (!reviewStep.fields.some((f: any) => f.key === "postal_license_number")) {
    reviewStep.fields.unshift(
      field("postal_license_number", "Postal license number", "رقم الرخصة البريدية", "text", false)
    );
  }
  // terms_accepted becomes a real checkbox (was free text) + its timestamp label.
  for (const s of renewal.steps)
    for (const f of s.fields ?? [])
      if (f.key === "terms_accepted") {
        f.type = "boolean";
        f.label = t("Terms, commitment form & IDEP integration accepted", "الموافقة على الشروط ونموذج التعهد وتكامل IDEP");
      }
  const financeStep = renewal.steps.find((s: any) => s.fields?.some((f: any) => f.key === "terms_accepted"));
  if (financeStep && !financeStep.fields.some((f: any) => f.key === "terms_accepted_at")) {
    financeStep.fields.push(
      field("terms_accepted_at", "Terms accepted at (date & time, UTC)", "تاريخ ووقت قبول الشروط (UTC)", "text", false)
    );
  }
  renewal.guidance = RENEWAL_GUIDANCE;
  if (renewal.submission?.apiFlow && !renewal.submission.apiFlow.notes?.includes("DECLARATION MAPPING"))
    renewal.submission.apiFlow.notes = (renewal.submission.apiFlow.notes ?? "") + RENEWAL_SF_DECLARATION_NOTE;

  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));
  console.log("EPGL Round-2 feedback applied:");
  console.log("  new_license docs:", issuanceDocsStep.documents.map((d: any) => d.key).join(", "));
  console.log("  new_license declaration fields:", issuanceDocsStep.fields.map((f: any) => f.key).join(", "));
  console.log("  renewal docs:", renewalDocsStep.documents.map((d: any) => d.key).join(", "));
  console.log("  renewal review fields:", reviewStep.fields.map((f: any) => f.key).join(", "));
  console.log("  new_license guidance:", issuance.guidance.length, "chars; renewal guidance:", renewal.guidance.length, "chars");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
