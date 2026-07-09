/**
 * Feedback: EPGL should ask for DOCUMENTS FIRST and extract details from them to
 * auto-fill the application, instead of asking many questions. This reorders both
 * EPGL journeys so the documents step comes first, and adds a per-journey
 * `guidance` playbook that tells the agent to collect documents, let the system
 * auto-fill from them (vision extraction in /api/upload), confirm, and only ask
 * for what the documents don't provide.
 *
 * The three source documents (see ~/Downloads/epgl-agent-docs):
 *   - Trade / Postal License  → company name (EN/AR), trade license no + dates,
 *                               emirate, email, address, activities
 *   - Memorandum of Association→ owner/partner name, nationality, passport, shares
 *   - Declaration & Undertaking→ legal consent (no data; acknowledgment only)
 *
 * Run: npx tsx scripts/restructure-epgl-documents-first.ts   (from apps/web)
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

const ISSUANCE_GUIDANCE = [
  "DOCUMENTS-FIRST. Do not interrogate the customer field by field. Instead:",
  "1) Start by asking the customer to upload their documents using the document slots in the panel: the Trade / Postal License, the Memorandum of Association (MOA), and the signed Declaration & Undertaking. The owner's Emirates ID is optional.",
  "2) The system reads each uploaded document automatically and pre-fills the application (company name EN/AR, trade license number + dates, emirate, address, email, and the primary owner's name, nationality and passport come from the license and the MOA). Watch the case panel fill in.",
  "3) Once documents are in, briefly show the customer what was captured and ask them to confirm it is correct. Only ask the customer to type in fields that the documents did NOT provide (for example the activity codes, region, or a contact person if missing). NEVER ask for a value the case already shows.",
  "4) The Declaration & Undertaking is a legal consent form — treat its upload as the customer's acknowledgment; do not try to read data from it.",
  "Then continue to duplicate-check and submission as before.",
].join("\n");

const RENEWAL_GUIDANCE = [
  "DOCUMENTS-FIRST. Do not ask field by field. Instead:",
  "1) Start by asking the customer to upload their current Trade / Postal License and the signed Declaration & Undertaking (and the quarterly financial statement if they have it).",
  "2) The system reads the license and pre-fills the trade license number, expiry date and trade names automatically — watch the case panel.",
  "3) Confirm the captured details with the customer, then ask ONLY for what no document provides: the quarterly leviable-income figures and the financial year, and the accountant contact. Never re-ask for anything the license already filled in.",
  "4) The Declaration & Undertaking upload is the customer's legal consent; do not extract data from it.",
  "Then continue with the renewal submission (terms, finance summaries) as before.",
].join("\n");

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog not found");
  const def = agent.definition as Record<string, any>;
  const J = (key: string) => def.journeys.find((j: any) => j.key === key);

  // ── New license: documents step FIRST, then company + owners (auto-filled). ──
  const issuance = J("new_license");
  const companyStep = issuance.steps.find((s: any) => s.key === "company_details");
  const ownersStep = issuance.steps.find((s: any) => s.key === "owners_contacts");
  issuance.guidance = ISSUANCE_GUIDANCE;
  issuance.steps = [
    {
      key: "documents",
      title: t("Upload documents", "رفع المستندات"),
      requiresAuth: false,
      fields: [],
      documents: [
        doc("trade_license", "Trade / Postal license", "الرخصة التجارية / البريدية"),
        doc("moa", "Memorandum of Association (MOA)", "عقد التأسيس"),
        doc("emirates_id", "Owner Emirates ID", "الهوية الإماراتية للمالك", "optional"),
        doc("commitment_form", "Signed Declaration & Undertaking", "الإقرار والتعهد الموقّع"),
      ],
    },
    { ...companyStep, title: t("Company details (auto-filled)", "بيانات الشركة (تُعبّأ تلقائياً)") },
    { ...ownersStep, title: t("Owners & contacts (auto-filled)", "الملاك وجهات الاتصال (تُعبّأ تلقائياً)") },
  ];

  // ── Renewal: documents step FIRST, then license review (auto-filled), finance. ──
  const renewal = J("renewal");
  const reviewStep = renewal.steps.find((s: any) => s.key === "license_review");
  const financeStep = renewal.steps.find((s: any) => s.key === "finance");
  renewal.guidance = RENEWAL_GUIDANCE;
  renewal.steps = [
    {
      key: "documents",
      title: t("Upload documents", "رفع المستندات"),
      requiresAuth: false,
      fields: [],
      documents: [
        doc("updated_trade_license", "Current trade / postal license", "الرخصة التجارية / البريدية الحالية"),
        doc("commitment_form", "Signed Declaration & Undertaking", "الإقرار والتعهد الموقّع"),
        doc("financial_statement", "Quarterly financial statement", "الإقرار المالي الربع سنوي", "optional"),
      ],
    },
    { ...reviewStep, title: t("License details (auto-filled)", "بيانات الرخصة (تُعبّأ تلقائياً)") },
    financeStep,
  ];

  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));
  console.log("EPGL journeys restructured documents-first:");
  for (const k of ["new_license", "renewal"]) {
    const j = J(k);
    console.log(`  ${k}: steps = ${j.steps.map((s: any) => s.key + (s.documents.length ? `[${s.documents.length} docs]` : "")).join(" → ")}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
