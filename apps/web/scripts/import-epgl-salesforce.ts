/**
 * Powers the EPGL agent from the Salesforce contract delivered by the SF team
 * (~/Downloads/epglagent/epgl-license-requests-api-latest 1.yaml, copied to
 * public/specs/epgl-license-requests.yaml).
 *
 * - Imports the spec as an "EPGL Salesforce" integration (staging env) with
 *   OAuth2 client-credentials auth (tokenUrl from the spec; client id/secret
 *   from EPGL_SF_CLIENT_ID / EPGL_SF_CLIENT_SECRET env — the delivered Postman
 *   environment file has them EMPTY, so until Salesforce shares real creds the
 *   integration imports configured-but-credential-less).
 * - Reshapes the epgl-dialog journeys to the contract's field/document model
 *   (issuance: company + owners + contact + docs; renewal: license + trial
 *   balance + branches) and points them at the imported tools via apiFlow.
 * - Sets activeEnvironment=staging so the tools are live for the agent.
 *
 * Run: npx tsx scripts/import-epgl-salesforce.ts   (from apps/web, dev server up)
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { parseSpec } from "../lib/openapi";
import { upsertEnvironment } from "../lib/integrations";

const SPEC_URL = process.env.SPEC_URL || "http://localhost:4500/specs/epgl-license-requests.yaml";
const TOKEN_URL = "https://epro--preprod2.sandbox.my.salesforce.com/services/oauth2/token";
const INTEGRATION_NAME = "EPGL Salesforce"; // tool prefix: epglsalesforce__*

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog agent not found");

  // 1) Import the OpenAPI contract → operations.
  const parsed = await parseSpec(SPEC_URL);
  console.log(`Parsed "${parsed.title}" — ${parsed.operations.length} operations from ${SPEC_URL}`);
  for (const op of parsed.operations) console.log(`  - ${op.toolName} (${op.method.toUpperCase()} ${op.path})`);

  const clientId = process.env.EPGL_SF_CLIENT_ID ?? "";
  const clientSecret = process.env.EPGL_SF_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    console.warn("!! EPGL_SF_CLIENT_ID / EPGL_SF_CLIENT_SECRET not set — importing without credentials (calls will fail until provided).");
  }

  await upsertEnvironment(agent.id, INTEGRATION_NAME, "staging", {
    specUrl: SPEC_URL,
    baseUrl: parsed.baseUrl,
    authType: "oauth2_cc",
    authValue: clientSecret || null,
    authHeader: null,
    oauthClientId: clientId || null,
    oauthTokenUrl: TOKEN_URL,
    operations: parsed.operations,
  });
  console.log(`Integration "${INTEGRATION_NAME}" upserted (staging) — base ${parsed.baseUrl}`);

  // 2) Journeys per the contract (issuance & renewal composite payloads).
  const def = agent.definition as Record<string, any>;
  const t = (en: string, ar: string) => ({ en, ar });
  const field = (key: string, en: string, ar: string, required = true) => ({
    key, label: t(en, ar), type: "text", validation: { required },
  });
  const doc = (key: string, en: string, ar: string, requirement: "mandatory" | "optional" = "mandatory") => ({
    key, label: t(en, ar), requirement, acceptedFormats: ["pdf", "png", "jpg"], maxSizeMb: 10,
  });

  const issuance = {
    key: "new_license",
    intent: "new_license",
    title: t("New Postal Activity License", "رخصة نشاط بريدي جديدة"),
    // Guest-allowed (NXN pattern) for testing: the Salesforce API carries no
    // customer identity either way — ownership verification is a product
    // decision. Flip back to true before customer-facing rollout.
    requiresAuth: false,
    steps: [
      {
        key: "company_details",
        title: t("Company details", "بيانات الشركة"),
        requiresAuth: false,
        fields: [
          field("company_name", "Company name (English)", "اسم الشركة (بالإنجليزية)"),
          field("company_name_ar", "Company name (Arabic)", "اسم الشركة (بالعربية)"),
          field("trade_license_number", "Trade license number", "رقم الرخصة التجارية"),
          field("license_expiry_date", "Trade license expiry date", "تاريخ انتهاء الرخصة التجارية"),
          field("regulator", "Licensing authority / regulator", "جهة الترخيص"),
          field("emirate", "Emirate", "الإمارة"),
          field("region", "Region / area", "المنطقة"),
          field("address_street", "Street address", "العنوان"),
          field("po_box", "PO Box", "صندوق البريد", false),
          field("activity_codes", "Postal activity code(s)", "رموز النشاط البريدي"),
        ],
        documents: [],
      },
      {
        key: "owners_contacts",
        title: t("Owners & contacts", "الملاك وجهات الاتصال"),
        requiresAuth: false,
        fields: [
          field("owner_name", "Owner / partner full name", "اسم المالك / الشريك"),
          field("owner_emirates_id", "Owner Emirates ID", "الهوية الإماراتية للمالك"),
          field("owner_nationality", "Owner nationality", "جنسية المالك"),
          field("owner_passport_no", "Owner passport number", "رقم جواز سفر المالك", false),
          field("owner_contact_no", "Owner contact number", "رقم هاتف المالك"),
          field("contact_name", "Primary contact person", "جهة الاتصال الرئيسية"),
          field("contact_email", "Contact email", "البريد الإلكتروني"),
          field("contact_phone", "Contact phone", "رقم الهاتف"),
          field("contact_designation", "Contact designation", "المسمى الوظيفي", false),
        ],
        documents: [],
      },
      {
        key: "documents",
        title: t("Documents", "المستندات"),
        requiresAuth: false,
        fields: [],
        documents: [
          doc("trade_license", "Trade license copy", "نسخة الرخصة التجارية"),
          doc("emirates_id", "Owner Emirates ID copy", "نسخة الهوية الإماراتية"),
          doc("moa", "Memorandum of Association (MOA)", "عقد التأسيس"),
          doc("commitment_form", "Signed commitment form", "نموذج التعهد الموقّع"),
        ],
      },
    ],
    submission: {
      action: "crm.createCase",
      readinessTitle: t("Submission readiness", "جاهزية الإرسال"),
      apiFlow: {
        service: "EPGL Salesforce (License Issuance)",
        saveTool: "epglsalesforce__submitLicenseRequest",
        notes:
          "Build ONE atomic composite payload with TOP-LEVEL {allOrNone: true, isAgentSource: true} exactly like the spec's 'issuance' example: Account first (referenceId NewAccount — company fields incl. EPG_Trade_license_no__c, EPG_Emirates__c, Billing address, License_Expiry_Date__c, RecordTypeId 0125f000001xIheAAE); then EPG_Partner__c (owners), Contact, User (portal user, field EPG_Emirates_Id__c), Members__c, EPG_Document__c and EPG_License_Request__c — children reference '@{NewAccount.id}'. License request: RecordTypeId 0125f000001xIhuAAE, EPG_Service__c a1H5f0000033Q7pEAE, serviceId S-EPG-000002, serviceNameEN 'Issue Postal Activity License'. RESPONSE: HTTP is ALWAYS 200 — judge ONLY by each item's body.success; array-body items fan out with '_<index>' suffixes (NewContact_0…); EPG_Document__c items are processed internally and omitted; on any failure every item echoes the same 'Rolled back due to allOrNone=true: …' message — relay the underlying error plainly. To UPDATE an existing application use the same tool with the 'update' shape: Account.Id + EPG_License_Request__c.Name required, children matched by EPG_Emirates_ID__c / Email / Name. Use epglsalesforce__duplicateCheck BEFORE a brand-new submission; after success share status via epglsalesforce__getRequestStatus (id = NewLicenseRequest id) and upload files with epglsalesforce__uploadDocument (base64) linked to that id.",
      },
    },
  };

  const renewal = {
    key: "renewal",
    intent: "renewal",
    title: t("Renew Postal Activity License", "تجديد رخصة النشاط البريدي"),
    requiresAuth: false, // guest-allowed for testing — see note on issuance

    steps: [
      {
        key: "license_review",
        title: t("License details", "بيانات الرخصة"),
        requiresAuth: false,
        fields: [
          field("trade_license_number", "Trade license number", "رقم الرخصة التجارية"),
          field("license_expiry_date", "New trade license expiry date", "تاريخ الانتهاء الجديد"),
          field("trade_name_en", "Trade name (English)", "الاسم التجاري (بالإنجليزية)", false),
          field("trade_name_ar", "Trade name (Arabic)", "الاسم التجاري (بالعربية)", false),
        ],
        documents: [],
      },
      {
        key: "finance",
        title: t("Financial summary", "الملخص المالي"),
        requiresAuth: false,
        fields: [
          field("financial_year", "Financial year (e.g. 2025)", "السنة المالية"),
          field("leviable_income_q1", "Leviable income — Q1 (AED)", "الدخل الخاضع للرسوم — الربع الأول"),
          field("leviable_income_q2", "Leviable income — Q2 (AED)", "الدخل الخاضع للرسوم — الربع الثاني"),
          field("leviable_income_q3", "Leviable income — Q3 (AED)", "الدخل الخاضع للرسوم — الربع الثالث"),
          field("leviable_income_q4", "Leviable income — Q4 (AED)", "الدخل الخاضع للرسوم — الربع الرابع"),
          field("accountant_name", "Accountant contact — full name", "اسم المحاسب"),
          field("accountant_email", "Accountant contact — email", "بريد المحاسب الإلكتروني"),
          field("accountant_phone", "Accountant contact — phone", "هاتف المحاسب", false),
          field("terms_accepted", "Terms, commitment form & IDEP integration accepted (yes/no)", "الموافقة على الشروط ونموذج التعهد وتكامل IDEP"),
        ],
        documents: [],
      },
      {
        key: "documents",
        title: t("Documents", "المستندات"),
        requiresAuth: false,
        fields: [],
        documents: [doc("updated_trade_license", "Renewed trade license copy", "نسخة الرخصة التجارية المجددة")],
      },
    ],
    submission: {
      action: "crm.createCase",
      readinessTitle: t("Renewal readiness", "جاهزية التجديد"),
      apiFlow: {
        service: "EPGL Salesforce (License Renewal)",
        saveTool: "epglsalesforce__submitLicenseRequest",
        notes:
          "Renewal composite with TOP-LEVEL {allOrNone: true, isAgentSource: true} per the spec's 'renewal' example. Account matched by EPG_Trade_license_no__c (editable fields ONLY: EPG_Trade_license_no__c, EPG_Trade_license_Expiry_date__c, EPG_Trade_Name_in_English__c/Arabic__c; RecordTypeId 0125f000001xIheAAE). MANDATORY GOTCHAS: (1) the license request MUST set EPG_Terms_and_Conditions__c, Approved_Commitment_Form__c, Mandatory_integration_with_IDEP__c AND EPG_Is_Financial_Statement_Submitted__c all true — collect explicit confirmation first; (2) include a Contact whose EPG_Designation__c contains 'Accountant' (use the accountant fields from the case); (3) quarterly figures go as EPG_Finance_Summary__c records — one per quarter: {EPG_License_Request__c: '@{NewLicenseRequest.id}', Quarter__c: 'Q1', EPG_Year__c: '<financial_year>', Name: 'Q1 <year>', EPG_Leviable_Income__c: <amount>, EPG_Non_Leviable_Income__c: 0}; (4) EPG_Finance_Summary__c has NO upsert key — NEVER call the submit twice for the same renewal (duplicates would be created); if unsure whether a submit landed, check epglsalesforce__getRequestStatus first. License request: RecordTypeId 0125f000001xIhwAAE, EPG_Service__c a1H5f0000033Q7lEAE, serviceId S-EPG-000003, serviceNameEN 'Renew Postal Activity License'. The backend auto-sets status 'Under document review' for renewals — expected, tell the customer their renewal is under review. HTTP is always 200 — judge only by body.success per item. If the response says 'No License found for this Account', the company has no active license to renew — explain that plainly and offer to start a NEW license application instead.",
      },
    },
  };

  def.journeys = [issuance, renewal];
  // Keep intent gating in sync with the journeys (guest-allowed for testing).
  def.intents = (def.intents ?? []).map((i: Record<string, unknown>) =>
    i.key === "new_license" || i.key === "renewal" ? { ...i, requiresAuth: false } : i
  );
  def.activeEnvironment = "staging";
  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));
  console.log("Journeys reshaped (issuance + renewal) and activeEnvironment=staging set.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
