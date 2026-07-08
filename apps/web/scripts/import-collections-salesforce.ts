/**
 * Stands up the Collections Agent from the Salesforce team's UAT package
 * (~/Downloads/epglagent/Collections Agent/, specs copied to public/specs/):
 *
 * - Agent "collections-dialog" (same tenant as EPGL) — an internal assistant for
 *   Finance/AR collections staff: look up an account's outstanding balance and
 *   log a completed collection call (Task + transcript) back to Salesforce.
 * - Integration "Collections Salesforce" (staging) on epg--epuat with OAuth2
 *   client-credentials (token URL from the spec). Client id/secret come from
 *   COLLECTIONS_SF_CLIENT_ID / COLLECTIONS_SF_CLIENT_SECRET — the delivered
 *   Postman environment has them EMPTY (Postman strips "current values" on
 *   export), so the integration imports credential-less until they arrive.
 *
 * Run: npx tsx scripts/import-collections-salesforce.ts  (from apps/web, dev server up)
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { parseSpec } from "../lib/openapi";
import { upsertEnvironment } from "../lib/integrations";

const BASE = process.env.SPEC_BASE || "http://localhost:4500";
const TOKEN_URL = "https://epg--epuat.sandbox.my.salesforce.com/services/oauth2/token";
const INTEGRATION_NAME = "Collections Salesforce"; // tool prefix: collectionssal__*

async function main() {
  const db = getDb();
  const [epgl] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!epgl) throw new Error("epgl-dialog agent not found (used as template + tenant)");

  // 1) Parse both UAT specs into one integration's operations.
  const retrieve = await parseSpec(`${BASE}/specs/collections-account-retrieve.yaml`);
  const composite = await parseSpec(`${BASE}/specs/collections-composite-callresult.yaml`);
  const operations = [...retrieve.operations, ...composite.operations];
  console.log(`Parsed ${operations.length} operations:`);
  for (const op of operations) console.log(`  - ${op.toolName} (${op.method.toUpperCase()} ${op.path})`);

  const clientId = process.env.COLLECTIONS_SF_CLIENT_ID ?? "";
  const clientSecret = process.env.COLLECTIONS_SF_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    console.warn("!! COLLECTIONS_SF_CLIENT_ID / COLLECTIONS_SF_CLIENT_SECRET not set — importing without credentials.");
  }

  // 2) Agent definition — clone EPGL's (valid per zod) and adapt.
  const t = (en: string, ar: string) => ({ en, ar });
  const def = JSON.parse(JSON.stringify(epgl.definition)) as Record<string, any>;
  def.slug = "collections-dialog";
  def.name = "EPG Collections Agent";
  def.persona =
    "You are the EPG Finance collections assistant, used INTERNALLY by collections staff (not by customers). " +
    "You help an agent prepare for and log collection calls: retrieve a customer's account and outstanding balance from Salesforce by account number, " +
    "and after a call, record the outcome in Salesforce as a completed Task with the transcript attached. " +
    "Be precise with amounts, dates, and identifiers; never invent balances or contact details — always fetch them.";
  def.greeting = t(
    "Ready when you are. Give me an account number to pull the outstanding balance, or say \"log a call\" to record a completed collection call.",
    "جاهز عندما تكون مستعداً. أعطني رقم الحساب لجلب الرصيد المستحق، أو قل \"سجّل مكالمة\" لتسجيل نتيجة مكالمة تحصيل."
  );
  def.theme = { ...def.theme, brandName: "EPG Collections" };
  delete def.theme.logoUrl; // no wordmark for the internal tool — falls back to the avatar tile
  def.guardrails = {
    ...def.guardrails,
    refusalTopics: ["discounts", "settlements", "payment plans", "legal advice", "waivers"],
    escalationOffer: t("This needs a Finance supervisor — flag it for manual follow-up.", "هذا يتطلب مشرف الشؤون المالية — علّمه للمتابعة اليدوية."),
  };
  def.intents = [
    {
      key: "account_lookup",
      description: t("Look up a customer's account and outstanding balance by account number", "الاستعلام عن حساب العميل والرصيد المستحق برقم الحساب"),
      requiresAuth: false,
    },
    {
      key: "log_call",
      journey: "collection_call",
      description: t("Record the result of a completed collection call (outcome, commitment, notes, transcript)", "تسجيل نتيجة مكالمة تحصيل مكتملة"),
      requiresAuth: false,
    },
    {
      key: "general",
      description: t("General questions about the collections process", "أسئلة عامة عن عملية التحصيل"),
      requiresAuth: false,
    },
  ];

  const field = (key: string, en: string, ar: string, required = true, extra: Record<string, unknown> = {}) => ({
    key, label: t(en, ar), type: "text", validation: { required }, ...extra,
  });

  def.journeys = [
    {
      key: "collection_call",
      intent: "log_call",
      title: t("Log a collection call", "تسجيل مكالمة تحصيل"),
      requiresAuth: false,
      steps: [
        {
          key: "account",
          title: t("Account", "الحساب"),
          requiresAuth: false,
          fields: [field("account_number", "Customer account number", "رقم حساب العميل")],
          documents: [],
        },
        {
          key: "outcome",
          title: t("Call outcome", "نتيجة المكالمة"),
          requiresAuth: false,
          fields: [
            {
              key: "call_outcome",
              label: t("Call outcome", "نتيجة المكالمة"),
              type: "enum",
              options: [
                { value: "Commitment", label: t("Commitment to pay", "التزام بالدفع") },
                { value: "No Commitment", label: t("No commitment", "بدون التزام") },
                { value: "Unreachable", label: t("Unreachable", "تعذّر الوصول") },
              ],
              validation: { required: true },
            },
            field("commitment_amount", "Commitment amount (AED)", "مبلغ الالتزام", false, { type: "number" }),
            field("commitment_date", "Promised-to-pay date", "تاريخ الدفع الموعود", false, { type: "date" }),
            field("call_notes", "Call notes / summary", "ملاحظات المكالمة", true, { type: "longtext" }),
            field("detected_language", "Call language (en/ar)", "لغة المكالمة", false),
            field("transcript", "Call transcript text", "نص المكالمة", true, { type: "longtext" }),
          ],
          documents: [],
        },
      ],
      submission: {
        action: "crm.createCase",
        readinessTitle: t("Call log readiness", "جاهزية سجل المكالمة"),
        apiFlow: {
          service: "Collections Salesforce (UAT)",
          detailsTool: "collectionssal__retrieveAccountByNumber",
          saveTool: "collectionssal__submitCallResult",
          notes:
            "1) LOOKUP: call collectionssal__retrieveAccountByNumber with q = \"SELECT Id, Name, Tech_accountNumber__c, Phone, BillingCountry, PreferredLanguage__pc, PrimaryBillingContact__r.Id, PrimaryBillingContact__r.Email, PrimaryBillingContact__r.MobilePhone FROM Account WHERE Tech_accountNumber__c = '<account_number>'\" and keep the Account Id (WhatId). If totalSize=0, say the account was not found — do not proceed. " +
            "2) SUBMIT: call collectionssal__submitCallResult with ONE atomic composite (allOrNone=true), 4 ordered subrequests: " +
            "taskUpsert = PATCH /services/data/v66.0/sobjects/Task/Correlation_ID__c/<correlation id — generate 'CORR-' + account number + '-' + today if the user doesn't supply one> with body {WhatId, Subject: 'Collection Call', RecordTypeId: '012FV000OtzpV8eYIE', Status: 'Completed', Call_Notes__c, Call_Outcome__c, Commitment_Amount__c, Commitment_Date__c, Detected_Language__c, Communication_Status__c: 'Pending'} (omit commitment fields unless outcome is Commitment); " +
            "transcript = POST ContentVersion {Title: 'Collection Call Transcript', PathOnClient: 'transcript.txt', VersionData: base64 of the transcript text}; " +
            "cvLookup = GET /services/data/v66.0/sobjects/ContentVersion/@{transcript.id}?fields=ContentDocumentId; " +
            "linkFile = POST ContentDocumentLink {ContentDocumentId: '@{cvLookup.ContentDocumentId}', LinkedEntityId: '@{taskUpsert.id}', ShareType: 'V', Visibility: 'AllUsers'}. " +
            "Inspect every compositeResponse item's httpStatusCode — any non-2xx means the whole call rolled back; relay the first error plainly. On success, confirm with the Task id. Salesforce then sends the customer email via its Flow — tell the agent the communication is queued (status Pending).",
        },
      },
    },
  ];
  def.activeEnvironment = "staging";
  def.allowedOrigins = [];

  // 3) Upsert the agent (same tenant as EPGL).
  const existing = await db.select().from(agents).where(eq(agents.slug, "collections-dialog")).limit(1);
  let agentId: string;
  if (existing.length) {
    agentId = existing[0]!.id;
    await db.update(agents).set({ definition: def as typeof epgl.definition, name: def.name }).where(eq(agents.id, agentId));
    console.log("Agent collections-dialog updated.");
  } else {
    const [row] = await db
      .insert(agents)
      .values({ tenantId: epgl.tenantId, slug: "collections-dialog", name: def.name, status: "live", definition: def as typeof epgl.definition })
      .returning();
    agentId = row!.id;
    console.log("Agent collections-dialog created (live).");
  }

  // 4) Register the integration.
  await upsertEnvironment(agentId, INTEGRATION_NAME, "staging", {
    specUrl: `${BASE}/specs/collections-composite-callresult.yaml`,
    baseUrl: retrieve.baseUrl, // https://epg--epuat.sandbox.my.salesforce.com
    authType: "oauth2_cc",
    authValue: clientSecret || null,
    authHeader: null,
    oauthClientId: clientId || null,
    oauthTokenUrl: TOKEN_URL,
    operations,
  });
  console.log(`Integration "${INTEGRATION_NAME}" upserted (staging) — base ${retrieve.baseUrl}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
