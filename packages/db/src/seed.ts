import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env") });

import { sql } from "drizzle-orm";
import { AgentDefinition } from "@dialog/config";
import { getDb } from "./client";
import { tenants, agents, kbDocuments, kbChunks, ensureVectorExtension } from "./schema";

/**
 * Seeds EPGL Dialog — the platform's first agent (tenant #1). Everything here is
 * data: branding, bilingual journeys, guardrails, integration bindings, and a
 * small grounded knowledge base. Adding the group's other two companies means
 * copying this shape with different values.
 */

const epgl: AgentDefinition = AgentDefinition.parse({
  slug: "epgl-dialog",
  tenantSlug: "epgl",
  name: "EPGL Dialog",
  persona:
    "You help businesses apply for and renew courier licenses with Emirates Post Group Licensing (EPGL). You are accurate, calm, and government-grade in tone. You guide applicants step by step, collect only what applies, validate as you go, and route to a human when needed.",
  locales: ["en", "ar"],
  allowedOrigins: [],
  greeting: {
    en: "Hello, I'm EPGL Dialog. I can help you apply for a new courier license, renew an existing one, or answer licensing questions. What would you like to do?",
    ar: "مرحباً، أنا EPGL Dialog. يمكنني مساعدتك في التقدّم بطلب رخصة بريد سريع جديدة، أو تجديد رخصة قائمة، أو الإجابة عن أسئلة الترخيص. كيف يمكنني خدمتك؟",
  },
  theme: {
    brandName: "EPGL Dialog",
    colors: {
      primary: "#1330F0",
      primaryForeground: "#FFFFFF",
      surface: "#FFFFFF",
      surfaceMuted: "#F4F6FB",
      text: "#0B1020",
      textMuted: "#5B6478",
      border: "#E2E6F0",
      success: "#0F9D58",
      warning: "#E8A100",
      danger: "#D23F31",
    },
    radius: "soft",
    fontFamily: "Inter, system-ui, sans-serif",
    launcher: { position: "bottom-right", label: "Ask EPGL" },
  },
  intents: [
    { key: "new_license", description: { en: "Apply for a new courier license", ar: "التقدّم بطلب رخصة جديدة" }, journey: "new_license", requiresAuth: true },
    { key: "renewal", description: { en: "Renew an existing courier license", ar: "تجديد رخصة قائمة" }, journey: "renewal", requiresAuth: true },
    { key: "licensing_info", description: { en: "Ask general questions about licensing, eligibility, and requirements", ar: "أسئلة عامة عن الترخيص والأهلية والمتطلبات" }, requiresAuth: false },
    { key: "human_help", description: { en: "Request a callback from an EPGL agent", ar: "طلب اتصال من موظف EPGL" }, requiresAuth: false },
  ],
  guardrails: {
    confidenceThreshold: 0.6,
    refusalTopics: ["legal advice", "tax advice", "Form 09", "audits", "inspections", "revenue protection"],
    requireGroundedAnswers: true,
    escalationOffer: {
      en: "I can connect you with an EPGL agent if you'd like.",
      ar: "يمكنني توصيلك بموظف من EPGL إذا رغبت.",
    },
  },
  integrations: {
    crm: { provider: "mock", settings: {}, secretRefs: [] },
    auth: { provider: "mock", settings: {}, secretRefs: [] },
    knowledge: { provider: "neon", settings: {}, secretRefs: [] },
    storage: { provider: "mock", settings: {}, secretRefs: [] },
  },
  journeys: [
    {
      key: "new_license",
      intent: "new_license",
      title: { en: "New Courier License", ar: "رخصة بريد سريع جديدة" },
      requiresAuth: true,
      submission: { action: "crm.createCase", readinessTitle: { en: "Submission readiness", ar: "جاهزية الإرسال" } },
      steps: [
        {
          key: "company_details",
          title: { en: "Company details", ar: "تفاصيل الشركة" },
          requiresAuth: true,
          fields: [
            { key: "company_name", label: { en: "Company name", ar: "اسم الشركة" }, type: "text", validation: { required: true, minLength: 2 } },
            { key: "trade_license_number", label: { en: "Trade license number", ar: "رقم الرخصة التجارية" }, type: "text", validation: { required: true } },
            {
              key: "emirate",
              label: { en: "Emirate", ar: "الإمارة" },
              type: "enum",
              options: [
                { value: "AUH", label: { en: "Abu Dhabi", ar: "أبوظبي" } },
                { value: "DXB", label: { en: "Dubai", ar: "دبي" } },
                { value: "SHJ", label: { en: "Sharjah", ar: "الشارقة" } },
                { value: "OTHER", label: { en: "Other", ar: "أخرى" } },
              ],
              validation: { required: true },
            },
            { key: "contact_email", label: { en: "Contact email", ar: "البريد الإلكتروني" }, type: "email", validation: { required: true } },
            { key: "contact_phone", label: { en: "Contact phone", ar: "رقم الهاتف" }, type: "phone", validation: { required: true } },
          ],
          documents: [],
        },
        {
          key: "shareholders",
          title: { en: "Shareholders", ar: "المساهمون" },
          requiresAuth: true,
          fields: [
            {
              key: "shareholders",
              label: { en: "Shareholders", ar: "المساهمون" },
              type: "group",
              validation: { required: true, sumChildrenEquals: 100, message: { en: "Shareholder ownership must total 100%.", ar: "يجب أن تبلغ نسب الملكية 100٪." } },
              children: [
                { key: "name", label: { en: "Name", ar: "الاسم" }, type: "text", validation: { required: true } },
                { key: "percentage", label: { en: "Ownership %", ar: "نسبة الملكية ٪" }, type: "percentage", validation: { required: true, min: 0, max: 100 } },
              ],
            },
          ],
          documents: [],
        },
        {
          key: "documents",
          title: { en: "Documents", ar: "المستندات" },
          requiresAuth: true,
          fields: [],
          documents: [
            { key: "trade_license", label: { en: "Trade license copy", ar: "نسخة الرخصة التجارية" }, requirement: "mandatory", acceptedFormats: ["pdf", "png", "jpg"], maxSizeMb: 10 },
            { key: "emirates_id", label: { en: "Emirates ID of signatory", ar: "الهوية الإماراتية للمفوّض" }, requirement: "mandatory", acceptedFormats: ["pdf", "png", "jpg"], maxSizeMb: 10 },
            { key: "moa", label: { en: "Memorandum of Association", ar: "عقد التأسيس" }, requirement: "optional", acceptedFormats: ["pdf"], maxSizeMb: 10 },
          ],
        },
      ],
    },
    {
      key: "renewal",
      intent: "renewal",
      title: { en: "License Renewal", ar: "تجديد الرخصة" },
      requiresAuth: true,
      submission: { action: "crm.createCase", readinessTitle: { en: "Renewal readiness", ar: "جاهزية التجديد" } },
      steps: [
        {
          key: "review",
          title: { en: "Review & update", ar: "المراجعة والتحديث" },
          requiresAuth: true,
          fields: [
            { key: "license_number", label: { en: "Existing license number", ar: "رقم الرخصة الحالية" }, type: "text", validation: { required: true }, prefillFrom: "crm.license" },
            { key: "updated_contact_phone", label: { en: "Updated contact phone", ar: "رقم الهاتف المحدّث" }, type: "phone", validation: { required: false } },
          ],
          documents: [
            { key: "updated_trade_license", label: { en: "Updated trade license", ar: "الرخصة التجارية المحدّثة" }, requirement: "mandatory", acceptedFormats: ["pdf", "png", "jpg"], maxSizeMb: 10 },
          ],
        },
      ],
    },
  ],
});

const KB: { title: string; source: string; content: string }[] = [
  {
    title: "Courier license eligibility",
    source: "EPGL Licensing Guide §1",
    content:
      "To apply for a courier license with Emirates Post Group Licensing (EPGL), the applicant must be a company holding a valid UAE trade license. The trade license activity must permit courier or delivery services. Both new applications and renewals are handled through EPGL.",
  },
  {
    title: "Required documents for a new courier license",
    source: "EPGL Licensing Guide §2",
    content:
      "A new courier license application requires: a copy of the company trade license, the Emirates ID of the authorized signatory, and shareholder details whose ownership percentages total 100%. A Memorandum of Association may be requested for certain company types. Documents must be clear copies in PDF, PNG, or JPG format.",
  },
  {
    title: "Renewal process",
    source: "EPGL Licensing Guide §3",
    content:
      "Existing license holders renew by confirming their current license details, updating any changed contact information, and uploading an updated trade license. EPGL pre-fills information already on record so applicants do not re-enter data EPGL already holds. Renewals should be submitted before the license expiry date to avoid penalties.",
  },
  {
    title: "Processing and status",
    source: "EPGL Licensing Guide §4",
    content:
      "After submission, EPGL creates a case and returns a reference number. Applicants can check the status of their application or renewal at any time once signed in. If documents are missing, the outstanding items and next steps are shown.",
  },
  {
    title: "Authentication",
    source: "EPGL Licensing Guide §5",
    content:
      "Anyone can ask licensing questions and request a callback without signing in. Submitting an application or renewal, uploading documents, or checking personal application status requires signing in through the UAE PASS authentication used by EPGL.",
  },
  {
    title: "Getting human help",
    source: "EPGL Licensing Guide §6",
    content:
      "If you need assistance from an EPGL agent, you can request a callback at any time. Provide your name, phone number, and the reason, and EPGL will follow up with a reference number.",
  },
];

/**
 * Second company under the group — proves the multiplier: a different brand,
 * locale set, journey, and knowledge base, generated entirely from config with
 * zero code changes. Rename/retheme for the real sibling entity.
 */
const sibling: AgentDefinition = AgentDefinition.parse({
  slug: "permits-dialog",
  tenantSlug: "group-co-2",
  name: "Permits Assistant",
  persona:
    "You help businesses request operating permits with a calm, professional, government-grade tone. You collect only what applies, validate as you go, and route to a human when needed.",
  locales: ["en"],
  allowedOrigins: [],
  greeting: {
    en: "Hi, I can help you request an operating permit or answer permit questions. How can I help?",
  },
  theme: {
    brandName: "Permits Assistant",
    colors: {
      primary: "#0F9D58",
      primaryForeground: "#FFFFFF",
      surface: "#FFFFFF",
      surfaceMuted: "#F1F7F3",
      text: "#0B1020",
      textMuted: "#5B6478",
      border: "#DDE9E1",
      success: "#0F9D58",
      warning: "#E8A100",
      danger: "#D23F31",
    },
    radius: "round",
    fontFamily: "Inter, system-ui, sans-serif",
    launcher: { position: "bottom-right", label: "Permits" },
  },
  intents: [
    { key: "permit_application", description: { en: "Apply for an operating permit" }, journey: "permit_application", requiresAuth: true },
    { key: "permit_info", description: { en: "Ask general questions about permits" }, requiresAuth: false },
    { key: "human_help", description: { en: "Request a callback" }, requiresAuth: false },
  ],
  guardrails: {
    confidenceThreshold: 0.6,
    refusalTopics: ["legal advice", "tax advice"],
    requireGroundedAnswers: true,
    escalationOffer: { en: "I can connect you with an agent if you'd like." },
  },
  integrations: {
    crm: { provider: "mock", settings: {}, secretRefs: [] },
    auth: { provider: "mock", settings: {}, secretRefs: [] },
    knowledge: { provider: "neon", settings: {}, secretRefs: [] },
    storage: { provider: "mock", settings: {}, secretRefs: [] },
  },
  journeys: [
    {
      key: "permit_application",
      intent: "permit_application",
      title: { en: "Operating Permit" },
      requiresAuth: true,
      submission: { action: "crm.createCase", readinessTitle: { en: "Submission readiness" } },
      steps: [
        {
          key: "applicant",
          title: { en: "Applicant details" },
          requiresAuth: true,
          fields: [
            { key: "business_name", label: { en: "Business name" }, type: "text", validation: { required: true, minLength: 2 } },
            { key: "activity", label: { en: "Permit activity" }, type: "text", validation: { required: true } },
            { key: "contact_email", label: { en: "Contact email" }, type: "email", validation: { required: true } },
          ],
          documents: [
            { key: "trade_license", label: { en: "Trade license copy" }, requirement: "mandatory", acceptedFormats: ["pdf", "png", "jpg"], maxSizeMb: 10 },
          ],
        },
      ],
    },
  ],
});

const SIBLING_KB: { title: string; source: string; content: string }[] = [
  {
    title: "Permit eligibility",
    source: "Permits Guide §1",
    content:
      "To request an operating permit, the applicant must be a business holding a valid trade license whose activity matches the requested permit. Both new requests and questions are handled through this assistant.",
  },
  {
    title: "Required documents",
    source: "Permits Guide §2",
    content:
      "An operating permit request requires a clear copy of the company trade license in PDF, PNG, or JPG format. Additional documents may be requested depending on the permit activity.",
  },
];

async function seedAgent(
  def: AgentDefinition,
  tenantName: string,
  kb: { title: string; source: string; content: string }[]
) {
  const db = getDb();
  const [tenant] = await db
    .insert(tenants)
    .values({ slug: def.tenantSlug, name: tenantName, settings: { dataResidency: "UAE" } })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: tenantName } })
    .returning();

  const [agent] = await db
    .insert(agents)
    .values({ tenantId: tenant!.id, slug: def.slug, name: def.name, status: "live", definition: def })
    .onConflictDoUpdate({ target: agents.slug, set: { definition: def, name: def.name, status: "live" } })
    .returning();

  await db.delete(kbDocuments).where(sql`${kbDocuments.agentId} = ${agent!.id}`);
  for (const item of kb) {
    const [doc] = await db
      .insert(kbDocuments)
      .values({ agentId: agent!.id, title: item.title, source: item.source, version: "1", locale: "en" })
      .returning();
    await db.insert(kbChunks).values({
      agentId: agent!.id,
      documentId: doc!.id,
      content: item.content,
      metadata: { source: item.source, title: item.title },
    });
  }
  console.log(`  ✓ ${def.slug} (tenant ${tenant!.slug}, ${kb.length} KB docs)`);
}

async function main() {
  const db = getDb();
  console.log("→ ensuring pgvector extension");
  await db.execute(ensureVectorExtension);

  console.log("→ seeding agents");
  await seedAgent(epgl, "Emirates Post Group Licensing", KB);
  await seedAgent(sibling, "Group Company 2", SIBLING_KB);

  console.log("✓ seed complete");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
