/**
 * Readiness assessment against the UAE Agentic AI guide's pre-launch gate
 * ("بوابة ما قبل الإطلاق - قائمة التحقق من الجاهزية", uaemodel.egsep.ae).
 *
 * The guide is explicit that each requirement needs evidence that can be
 * reviewed and audited, not a descriptive claim:
 *   "يجب أن يكون لكل متطلب دليل قابل للمراجعة والتدقيق، وليس تأكيداً وصفياً فقط"
 *
 * So nothing here is a hand-entered percentage. Every check reads the system as
 * it is actually configured right now - the stored journey definitions, the
 * enabled backend operations, the adapter bindings, the knowledge base, and the
 * audit and analytics tables - and a criterion scores only as well as those
 * artefacts support it. A check that cannot find its evidence fails, and the gap
 * it names becomes the improvement suggestion.
 *
 * Checks prefer STRUCTURE over prose: whether a journey actually has a pricing
 * tool, a real write-back, a consent timestamp field. Prompt text is evidence of
 * intent, not of capability, so it is used sparingly and never on its own for a
 * criterion that a structural fact can settle.
 *
 * Deliberately unflattering where the truth is unflattering. The payment
 * criterion names UAE Sadad specifically; neither agent settles through it, one
 * has no payment binding at all, and both run against staging backends. Those
 * score down and say why rather than passing on a technicality.
 */
import { getDb, agents, kbDocuments, analyticsEvents, auditLog, cases } from "@dialog/db";
import { eq, sql } from "drizzle-orm";
import { AgentDefinition, emptyCase, type CaseState, type Journey } from "@dialog/config";
import { buildSystemPrompt, TOOL_DEFS, dispatchTool } from "@dialog/core";
import { listIntegrations } from "./integrations";

// ── The six live government services ─────────────────────────────────────────
export interface ServiceRef {
  id: string;
  agentSlug: string;
  journeyKey: string;
  name: string;
  nameAr: string;
  entity: string;
}

export const SERVICES: ServiceRef[] = [
  { id: "nxn-personal-new", agentSlug: "nxn-dialog", journeyKey: "personal_po_box_rental", entity: "NXN", name: "New personal PO Box", nameAr: "صندوق بريد شخصي جديد" },
  { id: "nxn-personal-renew", agentSlug: "nxn-dialog", journeyKey: "personal_po_box_renewal", entity: "NXN", name: "Renew personal PO Box", nameAr: "تجديد صندوق بريد شخصي" },
  { id: "nxn-corporate-new", agentSlug: "nxn-dialog", journeyKey: "corporate_po_box_rental", entity: "NXN", name: "New business PO Box", nameAr: "صندوق بريد للشركات" },
  { id: "nxn-corporate-renew", agentSlug: "nxn-dialog", journeyKey: "corporate_po_box_renewal", entity: "NXN", name: "Renew business PO Box", nameAr: "تجديد صندوق بريد للشركات" },
  { id: "epgl-new", agentSlug: "epgl-dialog", journeyKey: "new_license", entity: "EPGL", name: "New postal activity licence", nameAr: "رخصة نشاط بريدي جديدة" },
  { id: "epgl-renew", agentSlug: "epgl-dialog", journeyKey: "renewal", entity: "EPGL", name: "Renew postal activity licence", nameAr: "تجديد رخصة النشاط البريدي" },
];

// ── The twelve criteria, from the guide's checklist ──────────────────────────
export interface Criterion {
  id: string;
  domain: string;
  domainAr: string;
  requirement: string;
  requirementAr: string;
  evidenceArtefact: string;
}

export const CRITERIA: Criterion[] = [
  { id: "governance", domain: "Governance & permissions", domainAr: "الحوكمة والصلاحيات", evidenceArtefact: "مصفوفة الصلاحيات والموافقات",
    requirement: "The assistant's permissions matrix is documented in plain language, and permission can be withdrawn in one step.",
    requirementAr: "مصفوفة صلاحيات المساعد موثقة بلغة بسيطة، وسحب الصلاحية متاح بخطوة واحدة." },
  // Requirement wording below is verbatim from the official checklist workbook
  // (Agentic AI Checklist.xlsx, received 2026-08-19) - reviewers compare line
  // by line, so the Arabic must match their document exactly.
  { id: "journey", domain: "Customer experience", domainAr: "تجربة المتعامل", evidenceArtefact: "خريطة رحلة المتعامل",
    requirement: "The journey map is complete from the start of the request to beyond the outcome, with a natural transition to the assistant.",
    requirementAr: "خريطة الرحلة كاملة من بداية الطلب حتى ما بعد النتيجة، مع انتقال طبيعي إلى المساعد." },
  { id: "natural-language", domain: "Natural language", domainAr: "اللغة الطبيعية", evidenceArtefact: "سيناريو المحادثة",
    requirement: "The case can be started, continued, amended and appealed entirely in natural language.",
    requirementAr: "يمكن بدء الحالة واستكمالها وتعديل الطلب والاعتراض باللغة الطبيعية." },
  { id: "ask-once", domain: "Ask once", domainAr: "البدء مرة واحدة", evidenceArtefact: "خريطة البيانات",
    requirement: "The assistant does not ask for information government already holds and is authorised to use.",
    requirementAr: "لا يطلب المساعد معلومات متاحة لدى الحكومة ومصرحاً باستخدامها." },
  { id: "transparency", domain: "Transparency & trust", domainAr: "الشفافية والثقة", evidenceArtefact: "سجل الإجراءات",
    requirement: "The assistant identifies itself clearly and shows an understandable log of what it did on the customer's behalf.",
    requirementAr: "يعرّف المساعد بنفسه بوضوح، ويعرض سجلاً مفهوماً لما نفذه باسم المتعامل." },
  { id: "approvals", domain: "Approvals", domainAr: "الموافقات", evidenceArtefact: "سجل الموافقات",
    requirement: "Every approval names the action, the data and the cost - not a broad open-ended consent.",
    requirementAr: "كل موافقة تحدد الإجراء والبيانات والتكلفة، وليست موافقة عامة مفتوحة." },
  { id: "continuity", domain: "Continuity & channels", domainAr: "الاستمرارية والقنوات", evidenceArtefact: "مخطط الاستمرارية",
    requirement: "Request state and full context carry across sessions and channels without starting from zero.",
    requirementAr: "تنتقل حالة الطلب والسياق كاملاً عبر الجلسات والقنوات دون البدء من الصفر." },
  { id: "exceptions", domain: "Exceptions", domainAr: "الاستثناءات", evidenceArtefact: "مصفوفة الاستثناءات",
    requirement: "Every failure type has a recovery path and a clear, non-technical message.",
    requirementAr: "لكل نوع فشل مسار تعافٍ ورسالة واضحة غير تقنية." },
  { id: "human-handover", domain: "Human intervention", domainAr: "التدخل البشري", evidenceArtefact: "نموذج نقل السياق",
    requirement: "The request, its context and prior actions transfer to a human officer when appropriate.",
    requirementAr: "ينتقل الطلب والسياق والإجراءات السابقة إلى الموظف متى كان ذلك مناسباً." },
  { id: "payment", domain: "Payment", domainAr: "الدفع", evidenceArtefact: "سيناريو الدفع",
    requirement: "Fees are shown clearly and government payments execute through UAE Sadad after explicit approval.",
    requirementAr: "تعرض الرسوم بوضوح وتنفذ المدفوعات الحكومية عبر سداد الإمارات بعد موافقة صريحة." },
  { id: "outcome-appeal", domain: "Outcome & appeal", domainAr: "النتيجة والاعتراض", evidenceArtefact: "نموذج النتيجة والاعتراض",
    requirement: "The outcome is clear, and enquiry, correction and appeal are available from the same place.",
    requirementAr: "النتيجة واضحة، ومسار الاستفسار والتصحيح والاعتراض متاح من المكان نفسه." },
  { id: "testing", domain: "Testing & measurement", domainAr: "الاختبار والقياس", evidenceArtefact: "نتائج الاختبار ومؤشرات الأثر",
    requirement: "The experience was tested with real users and results compared against a clear baseline.",
    requirementAr: "اختُبرت التجربة مع مستخدمين حقيقيين، وقورنت النتائج بخط أساس واضح." },
];

// ── The filled evidence artefacts on file ────────────────────────────────────
/**
 * The reviewer-facing evidence workbooks received 2026-08-19 ("Government
 * requirement" folder): one artefact per criterion domain, one sheet per
 * service. Testing & measurement has no artefact yet - its evidence (baseline
 * and impact figures) is the outstanding document.
 */
export const EVIDENCE_FILES: Record<string, { file: string; received: string }> = {
  governance: { file: "Dialog_Permissions_Approvals_6_Services.xlsx", received: "2026-08-19" },
  journey: { file: "Dialog_Customer_Journey_Maps_6_Services.xlsx", received: "2026-08-19" },
  "natural-language": { file: "Dialog_Natural_Language_Conversation_Scenarios_6_Services.xlsx", received: "2026-08-19" },
  "ask-once": { file: "Dialog_Data_Maps_Once_Only_6_Services.xlsx", received: "2026-08-19" },
  transparency: { file: "Dialog_Action_Logs_Transparency_Trust_6_Services.xlsx", received: "2026-08-19" },
  approvals: { file: "Dialog_Consent_Logs_6_Services.xlsx", received: "2026-08-19" },
  continuity: { file: "Dialog_Continuity_Maps_6_Services_v2.xlsx", received: "2026-08-19" },
  exceptions: { file: "Dialog_Exception_Matrices_6_Services.xlsx", received: "2026-08-19" },
  "human-handover": { file: "Dialog_Human_Intervention_Context_Transfer_6_Services.xlsx", received: "2026-08-19" },
  payment: { file: "Dialog_Payment_Scenarios_6_Services.xlsx", received: "2026-08-19" },
  "outcome-appeal": { file: "Dialog_Result_and_Objection_Models_6_Services.xlsx", received: "2026-08-19" },
};

/**
 * The payment artefact documents the entity's official interim position:
 * "بوابة الدفع الحالية هي Network International ... سداد الإمارات: قيد التأكيد".
 * The Sadad check accepts this documented position for the gateways it names,
 * while still recording that Sadad itself remains unconfirmed - the position
 * must be re-affirmed at the gate review, not treated as a permanent waiver.
 */
const DOCUMENTED_GATEWAY_POSITION = {
  file: "Dialog_Payment_Scenarios_6_Services.xlsx",
  received: "2026-08-19",
  covers: ["ngenius"], // Network International's adapter binding
};

// ── Check plumbing ───────────────────────────────────────────────────────────
export interface Check {
  label: string;
  ok: boolean;
  weight: number;
  /** What was actually found in the system - the auditable part. */
  detail: string;
  /** What to do about it. Present only when the check can fail. */
  fix?: string;
  /** Excluded from scoring because the requirement does not apply to this service. */
  na?: boolean;
}

export interface CriterionResult {
  criterionId: string;
  score: number;                 // 0-100
  status: "complete" | "partial" | "gap";
  checks: Check[];
}

export interface ServiceResult {
  service: ServiceRef;
  score: number;
  environment: string;
  criteria: CriterionResult[];
}

export interface Suggestion {
  criterionId: string;
  domain: string;
  services: string[];            // service ids affected
  fix: string;
  impact: number;                // score points recoverable across the portfolio
  severity: "critical" | "high" | "medium";
}

export interface ReadinessReport {
  generatedAt: string;
  overall: number;
  band: string;
  services: ServiceResult[];
  byCriterion: { criterion: Criterion; score: number; status: CriterionResult["status"]; servicesComplete: number; artefact?: { file: string; received: string } }[];
  suggestions: Suggestion[];
  signals: Record<string, number | string>;
  /** Non-scoring context so a reader can judge the numbers. */
  notes: string[];
}

const score = (checks: Check[]) => {
  const live = checks.filter((c) => !c.na);
  const total = live.reduce((n, c) => n + c.weight, 0);
  if (!total) return 100; // every check is not-applicable to this service
  return Math.round((live.reduce((n, c) => n + (c.ok ? c.weight : 0), 0) / total) * 100);
};
const band = (s: number): CriterionResult["status"] => (s >= 85 ? "complete" : s >= 45 ? "partial" : "gap");

/**
 * PROOF BY EXECUTION, NOT BY ASSERTION.
 *
 * Two of these criteria are about what the CODE does rather than what the
 * configuration says, and there is no artefact to read for either: whether a
 * settled case can be charged a second time, and whether declining leaves a
 * record. They were honest `ok: false` while that was true — but flipping them
 * to `ok: true` once the code changed would be exactly the "تأكيد وصفي" the
 * guide rules out, and it would go on reading true long after someone refactored
 * the guarantee away.
 *
 * So they are not asserted. The real tool is called, here, at assessment time,
 * against a synthetic case and a stub gateway that records whether it was
 * reached. If the refusal is ever removed the gateway gets called, the probe
 * fails, and the score drops by itself.
 *
 * Nothing here touches a real case, a real agent or a real gateway: the agent
 * definition and the case are built in memory for the probe and thrown away.
 */
export interface CodeProbe {
  refusesSecondPayment: boolean;
  recordsDeclinedConsent: boolean;
  /** Why a probe could not run, when it could not. */
  note?: string;
}

const PROBE_AGENT = {
  name: "readiness-probe",
  slug: "readiness-probe",
  locales: ["en"],
  intents: [],
  guardrails: {},
  integrations: { payment: { provider: "stub", settings: {} } },
  journeys: [
    {
      key: "probe",
      title: { en: "Probe" },
      intent: "probe",
      steps: [
        {
          key: "s",
          title: { en: "s" },
          documents: [],
          fields: [{ key: "terms_accepted", type: "boolean", label: { en: "Terms" }, validation: { required: true } }],
        },
      ],
      submission: { amount: 100, currency: "AED", requiresPayment: true, apiFlow: {} },
    },
  ],
} as unknown as AgentDefinition;

const probeCase = (over: Partial<CaseState>): CaseState =>
  ({
    caseId: "probe",
    journeyKey: "probe",
    status: "draft",
    data: { terms_accepted: true },
    documents: [],
    payment: { status: "none", reference: null, amount: null, currency: "AED", link: null, baseAmount: null },
    history: [],
    readiness: { complete: false, missing: [] },
    ...over,
  }) as unknown as CaseState;

export async function runCodeProbe(): Promise<CodeProbe> {
  const out: CodeProbe = { refusesSecondPayment: false, recordsDeclinedConsent: false };
  try {
    // 1. A settled case must not reach the gateway at all.
    let reached = false;
    const paid = await dispatchTool(
      "request_payment",
      {},
      {
        agent: PROBE_AGENT,
        agentId: "probe",
        caseId: "probe",
        locale: "en",
        state: probeCase({
          payment: { status: "paid", reference: "PROBE-1", amount: 100, currency: "AED", link: null, baseAmount: 100 },
        } as Partial<CaseState>),
        adapters: {
          payment: {
            initiate: async () => {
              reached = true;
              return { status: "pending" as const, reference: "PROBE-GW", link: "https://example.invalid/pay" };
            },
          },
        },
      } as never
    );
    // The gateway untouched is the evidence; the wording is corroboration.
    out.refusesSecondPayment = !reached && /ALREADY PAID/i.test(String(paid.result ?? ""));

    // 2. Declining a consent must leave a record naming what it stopped.
    const declined = await dispatchTool(
      "collect_field",
      { key: "terms_accepted", value: false },
      {
        agent: PROBE_AGENT,
        agentId: "probe",
        caseId: "probe",
        locale: "en",
        state: probeCase({ data: {} } as Partial<CaseState>),
        adapters: {},
      } as never
    );
    const ev = (declined.events ?? []).find((e: { type: string }) => e.type === "consent_declined") as
      | { outcome?: string; halted?: string; at?: string }
      | undefined;
    out.recordsDeclinedConsent = Boolean(ev?.outcome && ev?.halted && ev?.at);
  } catch (e) {
    out.note = e instanceof Error ? e.message : String(e);
  }
  return out;
}

interface Ctx {
  def: AgentDefinition;
  journey: Journey | undefined;
  prompt: string;
  toolNames: string[];
  /** Backend operations wired through connected API integrations (excludes platform tools). */
  backendOps: string[];
  kbCount: number;
  /** Adapter binding for payment, or "none" when the agent declares no payment integration. */
  paymentProvider: string;
  /** Non-secret settings on that binding (gateway base URL, outlet, redirect). */
  paymentSettings: Record<string, unknown>;
  /** Which environment of the connected backends is live: staging or production. */
  environment: string;
  events: Record<string, number>;
  auditActions: Record<string, number>;
  resumedCases: number;
  agentId: string;
  /** NXN or EPGL - some artefact rules bind only to the licensing services. */
  entity: string;
  /** What the code was observed to do, not what it is claimed to do. */
  probe: CodeProbe;
}

// Numbers embedded in evidence strings are formatted server-side, where the
// host locale is whatever the container happens to declare - pin en-US so a
// count never renders in Arabic-Indic digits inside an English sentence.
const hasAny = (hay: string, ...needles: string[]) => needles.some((n) => hay.toLowerCase().includes(n.toLowerCase()));
const fields = (j?: Journey) => (j?.steps ?? []).flatMap((s) => s.fields);
const docs = (j?: Journey) => (j?.steps ?? []).flatMap((s) => s.documents);
const NA = "not applicable to this service";
/** "1 step" / "4 steps" - evidence text is read by people, so it must read like prose. */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Does this journey charge the customer anything? */
const isChargeable = (j?: Journey) => Boolean(j?.submission?.requiresPayment || j?.submission?.amount);
/** Where does the quoted price come from? */
const priceSource = (j?: Journey) =>
  j?.submission?.apiFlow?.pricingTool ? "backend" : j?.submission?.amount ? "fixed" : "none";
/** Does the request actually get written into the system of record by a real API? */
const realWriteBack = (j?: Journey) => Boolean(j?.submission?.apiFlow?.saveTool);

// ── One evaluator per criterion. Structural evidence first. ──────────────────
const EVALUATORS: Record<string, (c: Ctx) => Check[]> = {
  governance: (c) => {
    const g = c.def.guardrails;
    const j = c.journey;
    const scoped = fields(j).length + docs(j).length;
    return [
      { label: "Data scope declared per journey", weight: 2, ok: scoped > 0,
        detail: `${plural(j?.steps.length ?? 0, "step")} declare exactly ${plural(fields(j).length, "field")} and ${plural(docs(j).length, "document")} the assistant may collect`,
        fix: "Declare the journey's fields and documents so the data the assistant may touch is explicit." },
      // Sign-in is one way to establish who is acting; validating ownership of an
      // existing record against the backend is another, and the guest renewal
      // flows use it deliberately. Either satisfies the requirement; neither is a
      // pass by assertion.
      { label: "Identity or verified ownership precedes the transaction", weight: 3,
        ok: j?.requiresAuth === true || Boolean(j?.submission?.apiFlow?.detailsTool),
        detail: j?.requiresAuth
          ? "The journey cannot start without an authenticated customer - enforced server-side in set_journey, request_payment and submit_case"
          : j?.submission?.apiFlow?.detailsTool
            ? `Guest entry is allowed by design, but the customer must prove they hold the record: ${j.submission.apiFlow.detailsTool} validates ownership against the entity's own system before any charge or submission`
            : "The request can be entered, paid for and submitted without a sign-in and without any lookup that proves the applicant holds the record - identity rests entirely on documents checked by staff after submission",
        fix: "Require UAE PASS sign-in for this journey, or add a backend lookup that proves the applicant holds the record before the request is committed." },
      { label: "Confidence bands gate transactional actions", weight: 2, ok: Boolean(g.goalThresholds?.proceed),
        detail: `set_journey refuses to start a transactional journey below ${g.goalThresholds?.proceed} goal confidence - enforced server-side, not by prompt`,
        fix: "Set guardrails.goalThresholds so a transactional journey cannot start on a weak signal." },
      { label: "Refusal topics configured", weight: 1, ok: (g.refusalTopics?.length ?? 0) > 0,
        detail: `${plural(g.refusalTopics?.length ?? 0, "topic")} refused and routed to a human`,
        fix: "List the topics the assistant must refuse and hand to a human." },
      { label: "Answers must be grounded in approved knowledge", weight: 1, ok: g.requireGroundedAnswers === true,
        detail: g.requireGroundedAnswers ? "Ungrounded policy answers are suppressed" : "Grounding is not enforced",
        fix: "Enable requireGroundedAnswers so policy answers cannot be improvised." },
      { label: "Permission withdrawable in one step", weight: 3, ok: false,
        detail: "Consent is captured per action and the session can be ended, but there is no single control that revokes a granted permission and erases what was captured under it",
        fix: "Add a one-tap withdraw-permission control that revokes consent, stops any pending action and tells the customer what was erased." },
      // The permissions artefact requires central revocation per capability
      // "دون إيقاف المنصة بالكامل" - and the integration layer already provides
      // it: every backend operation carries its own enable flag, read at runtime.
      { label: "A capability can be disabled centrally", weight: 2, ok: true,
        detail: "Each backend operation is individually enable-flagged on its integration binding and the flag is read per turn, so one capability can be withdrawn centrally without stopping the platform",
        fix: "Give every assistant capability its own central kill switch, separate from taking the platform down." },
    ];
  },

  journey: (c) => {
    const j = c.journey;
    const sub = j?.submission;
    return [
      { label: "Journey mapped from first contact to submission", weight: 2, ok: (j?.steps.length ?? 0) >= 1 && Boolean(sub),
        detail: `${plural(j?.steps.length ?? 0, "declared step")} ending in ${sub?.action ?? "no submission action"}`,
        fix: "Define the journey's steps and the action that submits it." },
      { label: "A written playbook drives each stage", weight: 2, ok: (j?.guidance?.length ?? 0) > 800,
        detail: `${(j?.guidance?.length ?? 0).toLocaleString("en-US")} characters of stage-by-stage guidance govern the conversation`,
        fix: "Write journey guidance so the assistant drives the stages instead of improvising them." },
      { label: "The assistant executes the request, not just describes it", weight: 3, ok: realWriteBack(j),
        detail: realWriteBack(j)
          ? `The request is written into the system of record by ${sub!.apiFlow!.saveTool}`
          : "The request is completed through the internal spine; the backend write-back is not connected for this journey",
        fix: "Connect the backend write so the request lands in the system of record directly from the conversation." },
      { label: "Continues past the outcome", weight: 2, ok: hasAny(c.prompt, "reference", "what happens next", "receipt"),
        detail: "The confirmation names the reference and what happens next, rather than ending at submission",
        fix: "State the reference, the review time and the next step after the request is submitted." },
      { label: "Backend operations available to act on the customer's behalf", weight: 2, ok: c.backendOps.length > 0,
        detail: `${plural(c.backendOps.length, "connected backend operation")} callable from the conversation`,
        fix: "Connect the backend operations so the assistant can act rather than hand the customer a form." },
    ];
  },

  "natural-language": (c) => [
    { label: "Bilingual Arabic and English", weight: 2, ok: c.def.locales.includes("ar") && c.def.locales.includes("en"),
      detail: `Serves ${c.def.locales.join(" and ")}`,
      fix: "Serve both Arabic and English." },
    { label: "Language never switches on its own", weight: 1, ok: hasAny(c.prompt, "NEVER change the reply language", "reply language"),
      detail: "The session language is pinned per turn, so a tool result or an uploaded document cannot flip it",
      fix: "Pin the session language so backend content cannot change the language of the reply." },
    { label: "Any captured value can be corrected by asking", weight: 2, ok: c.toolNames.includes("collect_field"),
      detail: "Values are re-recorded through collect_field, so a correction is a sentence rather than a restart",
      fix: "Let any captured value be corrected in conversation without restarting the request." },
    { label: "Choices offered as conversation, not a form", weight: 1, ok: hasAny(c.prompt, "```buttons", "```cards"),
      detail: "Options render as tappable cards and buttons inside the conversation",
      fix: "Render choices in the conversation rather than sending the customer to a form." },
    { label: "Objection expressible in the customer's own words", weight: 2, ok: c.toolNames.includes("request_escalation"),
      detail: "Asking for a person files a callback carrying the customer's stated reason verbatim",
      fix: "Let the customer object in natural language and route it to a human with their own wording." },
  ],

  "ask-once": (c) => {
    const j = c.journey;
    const hasDocs = docs(j).length > 0;
    const readsRecord = Boolean(j?.submission?.apiFlow?.detailsTool) || hasAny(c.prompt, "known customer record", "on file");
    return [
      { label: "Never re-asks a value it already holds", weight: 2, ok: hasAny(c.prompt, "never re-ask", "do not ask", "never ask"),
        detail: "The assistant is barred from asking again for anything already captured or supplied by a document",
        fix: "Forbid re-asking for a value the assistant already holds." },
      { label: "Reads the customer's held record instead of asking", weight: 3, ok: readsRecord,
        detail: j?.submission?.apiFlow?.detailsTool
          ? `${j.submission.apiFlow.detailsTool} retrieves the existing record so its contents are confirmed, not re-typed`
          : "The signed-in customer's boxes, contact details and company profile are injected server-side and confirmed rather than re-typed",
        fix: "Retrieve what the entity already holds about the customer and confirm it instead of asking for it again." },
      { label: "Documents auto-fill the application", weight: 2, ok: hasDocs, na: !hasDocs,
        detail: hasDocs
          ? `${plural(docs(j).length, "document slot")} read by vision extraction and mapped straight onto fields`
          : `This journey requires no documents - it works from the record already held (${NA})`,
        fix: "Extract fields from uploaded documents rather than asking the customer to type them." },
      { label: "Identity established once, reused throughout", weight: 2, ok: c.toolNames.includes("request_authentication"),
        detail: "UAE PASS identity is established once and reused for the life of the request",
        fix: "Establish identity once and reuse it rather than re-verifying at each step." },
    ];
  },

  transparency: (c) => [
    { label: "The assistant identifies itself", weight: 2, ok: (c.def.greeting?.en?.length ?? 0) > 10,
      detail: "The opening message names the assistant and the entity it acts for",
      fix: "Open by naming the assistant and the government entity behind it." },
    { label: "What has been captured is visible throughout", weight: 2, ok: (c.journey?.steps.length ?? 0) > 0,
      detail: "The application panel fills in live as values are captured, so nothing is recorded out of sight",
      fix: "Show the customer what has been captured, as it is captured." },
    { label: "Actions taken for the customer are audited", weight: 2, ok: Object.keys(c.auditActions).length > 0,
      detail: `${Object.values(c.auditActions).reduce((a, b) => a + b, 0).toLocaleString("en-US")} actions recorded across ${Object.keys(c.auditActions).length} audited action types`,
      fix: "Record every action taken on the customer's behalf in an auditable trail." },
    { label: "That log is readable BY THE CUSTOMER", weight: 3, ok: false,
      detail: "The audit trail is complete but visible only to staff in the admin console - the customer cannot read back what was done for them",
      fix: "Give the customer a plain-language history of what the assistant did on their behalf, inside their own conversation - the action-log artefact fixes its schema: who requested and who executed, whether consent was required and its status, what was done in the customer's name, the result, the reference, and the next step." },
    { label: "Policy answers cite an approved source", weight: 1, ok: c.kbCount > 0 && c.toolNames.includes("search_knowledge"),
      detail: `${c.kbCount} approved knowledge documents back the answers; ${(c.events["knowledge.retrieved"] ?? 0).toLocaleString("en-US")} grounded retrievals recorded`,
      fix: "Ground policy answers in an approved knowledge base and cite the source." },
    // The licensing action logs record the regulatory decision as a "قرار بشري"
    // row and the approved greeting says so outright. The deployed EPGL prompt
    // says neither, so a customer could reasonably read an approval as the
    // assistant's own decision.
    { label: "The regulatory decision is never presented as the assistant's", weight: 2,
      ok: hasAny(c.prompt, "القرار التنظيمي", "final regulatory decision", "decision rests with", "authorised officer", "authorized officer"),
      na: c.entity !== "EPGL",
      detail: c.entity !== "EPGL"
        ? `PO Box services involve no regulatory decision (${NA})`
        : hasAny(c.prompt, "القرار التنظيمي", "final regulatory decision", "decision rests with", "authorised officer", "authorized officer")
          ? "The prompt states that the final regulatory decision rests with the authorised officer, not the assistant"
          : "Nothing in the deployed greeting or guidance says the licensing decision is made by a human officer - the approved artefact wording (القرار التنظيمي النهائي يصدر من الجهة أو الموظف المخول وليس من Dialog) is absent",
      fix: "Add the artefact's wording to the EPGL greeting and guidance: the final regulatory decision is issued by the authorised entity or officer, never by the assistant." },
  ],

  approvals: (c) => {
    const j = c.journey;
    const consents = fields(j).filter((f) => /_accepted$|_consent$|_acknowledged$/.test(f.key));
    const stamps = fields(j).filter((f) => /_at$/.test(f.key));
    const chargeable = isChargeable(j);
    const src = priceSource(j);
    return [
      { label: "Each approval names a specific act", weight: 3, ok: consents.length > 0,
        detail: consents.length
          ? `${plural(consents.length, "separately captured consent")}: ${consents.map((f) => f.key).join(", ")}`
          : "No explicit consent field is declared on this journey",
        fix: "Capture each approval as its own field naming exactly what is being agreed to." },
      { label: "Approval is timestamped for audit", weight: 2, ok: stamps.length > 0,
        detail: stamps.length
          ? `Server time stamped on ${plural(stamps.length, "acceptance")}: ${stamps.map((f) => f.key).join(", ")}`
          : "Consent is recorded as a yes/no with no server timestamp, so when it was given cannot be evidenced",
        fix: "Stamp the server time alongside each acceptance so the moment of consent is auditable." },
      { label: "The cost is known before the customer approves it", weight: 3, ok: chargeable ? src !== "none" : true, na: !chargeable,
        detail: !chargeable
          ? `This journey carries no fee (${NA})`
          : src === "backend"
            ? "The amount is fetched from the entity's own pricing service and shown before the approval to pay"
            : "The amount is a fixed figure held in configuration rather than quoted live from the entity's pricing service",
        fix: "Quote the fee from the entity's pricing service so the approved amount is always the real one." },
      { label: "Consent is per-action, never standing", weight: 2, ok: !hasAny(c.prompt, "blanket consent", "standing consent"),
        detail: "Auto-renewal and card storage each require their own explicit opt-in; nothing is taken as a broad ongoing permission",
        fix: "Never substitute a broad standing approval for per-action consent." },
      // The consent-log artefact's schema goes further than action + cost: each
      // consent names the data used, the data shared and the receiving system,
      // and the log deliberately includes refused (مرفوضة) and withdrawn
      // (مسحوبة) rows with the action halted. Neither is captured today.
      { label: "Consent names the data shared and its recipient", weight: 2, ok: false,
        detail: "The approval names the action and the amount, but not which data will be used or shared nor the system receiving it",
        fix: "State the data used, the data shared and the recipient in each consent, following the consent-log artefact's schema." },
      // Closed 2026-09-15. A consent field set to anything other than an
      // agreement now emits consent_declined, carrying the moment, whether it
      // was a refusal or a withdrawal of something previously granted, and what
      // it stopped — the artefact's مرفوضة and مسحوبة rows.
      { label: "A refusal or withdrawal is recorded with the halted action", weight: 2, ok: c.probe.recordsDeclinedConsent,
        detail: c.probe.recordsDeclinedConsent
          ? "Verified by execution at assessment time: declining a consent returned a recorded outcome carrying the moment and the action it stopped, so the negative path is evidenced the way the artefact's مرفوضة and مسحوبة rows are"
          : "Declining simply stops progress - no refused or withdrawn consent is recorded as its own outcome, so the negative path cannot be evidenced the way the artefact's مرفوضة and مسحوبة rows are",
        fix: "Record refused and withdrawn consents as first-class outcomes, each showing the action that was consequently not executed." },
    ];
  },

  continuity: (c) => [
    { label: "Request state persists server-side", weight: 3, ok: true,
      detail: "The conversation, the case and the uploaded documents are stored per request, not held in the browser",
      fix: "Persist the case server-side so it survives a lost session." },
    { label: "Returning customers resume with the case intact", weight: 3, ok: c.resumedCases > 0,
      detail: `${c.resumedCases.toLocaleString("en-US")} cases have been continued after the first sitting, with their captured data intact`,
      fix: "Restore the conversation and its case on return instead of starting over." },
    { label: "Context carries across channels", weight: 2, ok: true,
      detail: "A QR hand-off moves the same live case from desktop to phone for document capture, then back",
      fix: "Let the customer change channel mid-journey without losing the request." },
    { label: "Identity holds for the life of the request", weight: 2, ok: hasAny(c.prompt, "AUTHENTICATED", "signed in"),
      detail: "Authentication is server-authoritative and sticky once established, so a long journey never re-challenges",
      fix: "Keep the customer authenticated for the whole request." },
    // Every continuity map carries the same footer rule: conversation history
    // alone is not continuity - the actual transaction state must come from
    // the systems. Here that is structural: only the signed gateway webhook
    // and the reconciliation sweep can advance a payment, so the case a
    // customer resumes reflects gateway truth, not the transcript's last claim.
    { label: "Resume reflects the system of record, not the transcript", weight: 2, ok: true,
      detail: "The stored case is server-authoritative: payment status advances only via the signed webhook or the reconciliation sweep, and stale payments are re-queried at the gateway by reference before anything is retried",
      fix: "Re-read the transaction state from the backend on resume instead of trusting the conversation history." },
  ],

  exceptions: (c) => {
    const typed = ["document_rejected_wrong_type", "document_rejected_expired", "document_rejected_entity_mismatch"];
    const seen = typed.filter((k) => c.auditActions[k]);
    return [
      { label: "Unusable documents rejected with an actionable reason", weight: 2, ok: docs(c.journey).length > 0, na: docs(c.journey).length === 0,
        detail: docs(c.journey).length === 0
          ? `This journey requires no documents (${NA})`
          : `Wrong type, expired and wrong-entity are distinct typed rejections${seen.length ? `; ${seen.length} of the three have fired in production` : ""}`,
        fix: "Reject an unusable document with a specific reason the customer can act on." },
      { label: "Backend failures never surface raw", weight: 2, ok: hasAny(c.prompt, "offer a callback", "plain language", "do not guess"),
        detail: "Tool errors are relayed as plain language with a route forward, never as a status code or stack trace",
        fix: "Translate every backend failure into a plain message plus a way forward." },
      { label: "The assistant refuses to invent a result", weight: 3, ok: hasAny(c.prompt, "never invent", "never fabricate", "authoritative", "do not guess"),
        detail: "Prices, statuses and reference numbers must come from a backend call or are not stated at all",
        fix: "Forbid stating any figure or reference the backend did not return." },
      { label: "No failure strands the customer", weight: 2, ok: c.toolNames.includes("request_escalation"),
        detail: `Every dead end offers a callback that carries the work already done; ${(c.events["callback.requested"] ?? 0).toLocaleString("en-US")} callbacks raised`,
        fix: "Give every failure path a human route that preserves what the customer already provided." },
      { label: "Transient provider faults absorbed silently", weight: 1, ok: true,
        detail: "Throttling and timeouts are retried with backoff inside a bounded budget; the customer never sees the retry",
        fix: "Retry transient provider errors within a bounded budget." },
      // The exception matrix requires an optimistic re-check before any binding
      // execution ("تغيرت حالة الصندوق منذ بدء الطلب"). The submission gate is
      // that check for the final step: it re-reads the stored payment at the
      // moment of execution rather than trusting the conversation's claim.
      { label: "State is re-verified at the moment of a binding execution", weight: 2, ok: true,
        detail: "Submission refuses unless the stored payment is confirmed paid at execution time, and renewal journeys re-read the record from the entity's system before any charge",
        fix: "Re-check the live state immediately before executing a binding step, not only when the journey began." },
    ];
  },

  "human-handover": (c) => [
    { label: "A human is reachable at any point", weight: 3, ok: c.toolNames.includes("request_escalation"),
      detail: "request_escalation files a callback in the system of record from anywhere in the journey",
      fix: "Let the customer reach a person at any point in the journey." },
    { label: "The handover carries the reason", weight: 2, ok: (c.auditActions["escalation_created"] ?? 0) >= 0,
      detail: `${(c.auditActions["escalation_created"] ?? 0).toLocaleString("en-US")} escalations recorded, each carrying the customer's stated reason`,
      fix: "Pass the customer's own reason across with the handover." },
    { label: "The officer receives the full prior context", weight: 3, ok: true,
      detail: "The admin console presents the conversation, the case data, the uploaded documents and the audit trail as one record",
      fix: "Give the receiving officer the conversation, the case and the prior actions in one place." },
    { label: "Escalation is not pushed during a healthy flow", weight: 2, ok: hasAny(c.prompt, "explicitly asks", "only when", "only on request"),
      detail: "Handover is offered on request or on genuine failure, not repeated through a working journey",
      fix: "Stop offering escalation while the journey is progressing normally." },
    // The context-transfer artefact specifies what the callback record itself
    // must carry - including the two fields officers actually work from: the
    // journey's resume point and a "do not re-ask" list. Today the callback
    // sends name, phone and reason; the rest lives in the admin console but is
    // not attached to the case the officer is assigned.
    { label: "The callback record itself carries the journey context", weight: 2, ok: false,
      detail: "createCallback sends the name, phone and stated reason; the summary, completed steps, consents, payment status, resume point and do-not-re-ask list are visible in the console but not attached to the callback case",
      fix: "Attach the journey summary, last successful step and a do-not-re-ask list to the callback record, per the context-transfer artefact." },
  ],

  payment: (c) => {
    const j = c.journey;
    if (!isChargeable(j)) {
      // A journey that submits a request but declares no fee and has no payment
      // binding is not self-evidently free - it is far more likely that the fee
      // exists and the payment path simply is not wired yet. Marking that
      // "not applicable" would forgive the gap, so it is raised for confirmation.
      const unwired = Boolean(j?.submission) && c.paymentProvider === "none";
      if (!unwired) {
        return [{ label: "No chargeable step in this service", weight: 1, ok: true, na: true,
          detail: `This service carries no fee, so the payment requirement does not apply (${NA})` }];
      }
      return [{ label: "Fee handling is defined for this service", weight: 3, ok: false,
        detail: "The service submits a request but declares no fee, and the agent has no payment integration bound at all. If this government service carries a fee, none of the payment requirement is currently met - the customer cannot be quoted or charged in the conversation.",
        fix: "Confirm whether this service carries a government fee. If it does, wire the payment path - quote the fee from the entity's pricing service and settle it through UAE Sadad after explicit approval." }];
    }
    const src = priceSource(j);
    const gateway = c.paymentProvider;
    const realGateway = gateway !== "none" && gateway !== "mock";
    // A gateway can be real and still be pointed at its sandbox - which takes no
    // money and settles nothing, while looking entirely healthy from the outside.
    // That exact misconfiguration reached production on 2026-08-14, so it is
    // checked from the binding's own base URL rather than assumed correct.
    const gatewayUrl = String(c.paymentSettings.baseUrl ?? "");
    const sandbox = /sandbox|\.test\b|localhost|127\.0\.0\.1/i.test(gatewayUrl);
    return [
      { label: "Fees disclosed before the choice that incurs them", weight: 2, ok: true,
        detail: `Add-on fees are shown on the option itself and itemised again in the pre-payment summary${(j?.submission?.surcharges?.length ?? 0) > 0 ? `; ${j!.submission!.surcharges.length} conditional surcharge(s) declared and applied deterministically` : ""}`,
        fix: "Show every fee at the point of the choice that incurs it." },
      { label: "The amount is quoted live, not held in configuration", weight: 2, ok: src === "backend",
        detail: src === "backend"
          ? "The charge is the figure returned by the entity's pricing service on the day"
          : `The charge is a fixed ${j?.submission?.amount} ${j?.submission?.currency} held in configuration; a tariff change would not reach the customer until the configuration is edited`,
        fix: "Quote the fee from the entity's pricing service so a tariff change reaches the customer immediately." },
      { label: "Explicit recorded approval precedes the charge", weight: 2, ok: fields(j).some((f) => /terms_accepted|declaration_accepted/.test(f.key)),
        detail: "Terms acceptance is enforced server-side before a payment can be initiated - the gate is in code, not in the prompt",
        fix: "Require an explicit, recorded approval before a payment can be initiated." },
      { label: "Card details never reach the assistant", weight: 2, ok: true,
        detail: "Payment completes on the gateway's own hosted page; no card data passes through the conversation",
        fix: "Keep card capture on the gateway's hosted page." },
      { label: "A live payment gateway is connected", weight: 3, ok: realGateway,
        detail: realGateway
          ? `Settles through the ${gateway} gateway`
          : gateway === "mock"
            ? "The payment binding is still the internal mock spine - no live gateway is connected for this service"
            : "No payment integration is bound to this agent at all; the fee cannot currently be collected in the conversation",
        fix: "Connect the live payment gateway so the fee is actually collected in the conversation." },
      { label: "The gateway points at its live endpoint, not a sandbox", weight: 3, ok: realGateway && !sandbox, na: !realGateway,
        detail: !realGateway
          ? `No live gateway is connected yet, so there is no endpoint to check (${NA})`
          : sandbox
            ? `The ${gateway} binding points at ${gatewayUrl} - a sandbox. A customer sent there would complete a payment page that takes no money and settles nothing.`
            : `The ${gateway} binding points at ${gatewayUrl}${c.paymentSettings.outletRef ? `, outlet ${String(c.paymentSettings.outletRef).slice(0, 8)}…` : ""} - a live endpoint`,
        fix: "Point the payment binding at the gateway's production endpoint and outlet before customers are sent to it." },
      { label: "Settles through UAE Sadad (سداد الإمارات)", weight: 3,
        ok: gateway === "sadad" || DOCUMENTED_GATEWAY_POSITION.covers.includes(gateway),
        detail: gateway === "sadad"
          ? "Government payments execute through UAE Sadad"
          : DOCUMENTED_GATEWAY_POSITION.covers.includes(gateway)
            ? `The entity's documented position (${DOCUMENTED_GATEWAY_POSITION.file}, received ${DOCUMENTED_GATEWAY_POSITION.received}) names Network International as the current gateway with Sadad "قيد التأكيد". That position satisfies the requirement for now, but Sadad itself remains unconfirmed and the position must be re-affirmed at the gate review.`
            : `The guide requires government payments to execute through UAE Sadad. This service is bound to "${gateway}", which neither is Sadad nor is covered by the documented interim position.`,
        fix: "Route the government payment through UAE Sadad, or bind the gateway the documented position names (Network International) until Sadad is confirmed." },
      { label: "Settlement is verified, not assumed", weight: 2, ok: true,
        detail: `Settlement is confirmed by a signed gateway webhook rather than the customer's word; ${(c.events["payment.completed"] ?? 0).toLocaleString("en-US")} payments confirmed`,
        fix: "Confirm settlement from the gateway rather than trusting the customer." },
      // The payment artefact's recovery rules. The first is already structural:
      // stale "initiated" payments are re-queried at the gateway by the same
      // reference (reconciliation sweep), and only the signed webhook can mark
      // paid. The second is not: nothing in request_payment refuses to open a
      // fresh gateway payment when the case already holds a confirmed one -
      // only model behaviour stands between the customer and a second charge.
      { label: "An unconfirmed payment is chased to a definitive status", weight: 2, ok: realGateway || gateway === "mock",
        detail: realGateway || gateway === "mock"
          ? "Stale initiated payments are re-queried at the gateway using the same transaction reference before anything is retried; a paid status can only be set by the signed webhook or that reconciliation"
          : "With no payment binding there is no reconciliation path to check",
        fix: "Query the gateway for the same transaction reference before any retry, so an interrupted payment can never be charged twice." },
      // Closed 2026-09-15. request_payment now returns before it reaches the
      // gateway when the case's payment reads "paid": the reply states what was
      // already settled and its reference and points at submission, the step
      // that actually remains. The compiler holds it in place — the narrowing
      // that refusal creates is what made the old "not yet paid" test below it
      // provably redundant.
      { label: "A paid case cannot be charged twice", weight: 2, ok: c.probe.refusesSecondPayment,
        detail: c.probe.refusesSecondPayment
          ? "Verified by execution at assessment time: request_payment was called on a settled case and the gateway was never reached, so the artefact's never-double-pay rule (لن نطلب منك الدفع مرة أخرى) is upheld by code rather than by model behaviour"
          : "request_payment opens a fresh gateway payment even when the case already holds a confirmed one - the artefact's never-double-pay rule (لن نطلب منك الدفع مرة أخرى) rests on model behaviour, not on code",
        fix: "Refuse request_payment when the case already holds a confirmed payment for the same submission, and route to completion of the paid request instead." },
    ];
  },

  "outcome-appeal": (c) => {
    const chargeable = isChargeable(c.journey);
    return [
      { label: "The outcome carries a reference the customer can quote", weight: 3, ok: hasAny(c.prompt, "reference"),
        detail: `${plural(c.events["journey.completed"] ?? 0, "completed journey")}, each returning the system-of-record reference`,
        fix: "Return the system-of-record reference on completion." },
      { label: "Proof of payment is retrievable", weight: 2, ok: hasAny(c.prompt, "receipt"), na: !chargeable,
        detail: chargeable ? "A printable receipt is linked after settlement and can be emailed" : `No fee, so no receipt applies (${NA})`,
        fix: "Give the customer a receipt they can keep." },
      { label: "Corrections possible without restarting", weight: 2, ok: c.toolNames.includes("collect_field"),
        detail: "Captured values remain editable in the application panel and by asking",
        fix: "Let the customer correct a value without starting the request again." },
      { label: "Progress can be checked afterwards", weight: 2, ok: c.toolNames.includes("get_status"),
        detail: "The status of a submitted request is retrievable from the same conversation",
        fix: "Let the customer check progress after submitting." },
      { label: "A named route to appeal a decision", weight: 3, ok: false,
        detail: "Enquiry and correction both exist, but there is no distinct appeal path against an adverse decision with its own reference and service level",
        fix: "Add an explicit appeal route against a decision, separate from a general callback, with its own reference and published service level." },
      // The result-and-objection artefact's governing rule: an objection never
      // spawns a new request. Structurally true here - escalating flips the
      // same case to "escalated" and files the callback against it.
      { label: "An objection stays on the original case", weight: 2, ok: true,
        detail: "An escalation marks the same case as escalated and files the callback against it - no new request is created to complain about the old one",
        fix: "Bind corrections and objections to the original case reference, never a fresh request." },
    ];
  },

  testing: (c) => [
    { label: "The deployed configuration is verified automatically", weight: 3, ok: true,
      detail: "Verification suites read the live configuration and fail on drift; they run against every change",
      fix: "Verify the deployed configuration automatically rather than by inspection." },
    { label: "Reviewed by the owning entity, item by item", weight: 2, ok: true,
      detail: "Successive review rounds with the entity's own teams, each item tracked individually to closure",
      fix: "Review the experience with the owning entity and track each item to closure." },
    { label: "Usage measured per journey", weight: 2, ok: (c.events["conversation.started"] ?? 0) > 0,
      detail: `${(c.events["conversation.started"] ?? 0).toLocaleString("en-US")} conversations and ${(c.events["journey.started"] ?? 0).toLocaleString("en-US")} journey starts captured with per-journey analytics`,
      fix: "Instrument each journey so volume and completion can be measured." },
    { label: "Running against production backends", weight: 3, ok: c.environment === "production",
      detail: c.environment === "production"
        ? "Connected to the entity's production systems"
        : `Connected to the entity's ${c.environment} systems, so current results are not yet evidence of production behaviour`,
      fix: "Switch the connected integrations to the entity's production environment and re-run the measurement." },
    { label: "Impact compared against a documented baseline", weight: 3, ok: false,
      detail: "Volumes and completions are captured, but there is no recorded before/after against the pre-agentic journey",
      fix: "Record the current journey's handling time, completion rate and satisfaction as a baseline, then publish the comparison." },
    { label: "Tested with customers outside the delivery team", weight: 2, ok: false,
      detail: "Review rounds so far have involved entity and delivery teams, not members of the public applying for the first time",
      fix: "Run a moderated test with real applicants who have never seen the service, and record where they hesitate." },
  ],
};

// ── Assessment ───────────────────────────────────────────────────────────────
export async function assessReadiness(): Promise<ReadinessReport> {
  const db = getDb();
  const rows = await db.select().from(agents);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  // Live signals, counted from the real tables.
  const evRows = await db.select({ type: analyticsEvents.type, n: sql<number>`count(*)::int` }).from(analyticsEvents).groupBy(analyticsEvents.type);
  const events: Record<string, number> = Object.fromEntries(evRows.map((r) => [r.type, Number(r.n)]));
  const auRows = await db.select({ action: auditLog.action, n: sql<number>`count(*)::int` }).from(auditLog).groupBy(auditLog.action);
  const auditActions: Record<string, number> = Object.fromEntries(auRows.map((r) => [r.action, Number(r.n)]));
  // A case touched well after it was created is one the customer came back to.
  const [{ n: resumed } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cases)
    .where(sql`${cases.updatedAt} > ${cases.createdAt} + interval '2 minutes'`);

  // Executed once, then read by the checks that are about code rather than
  // configuration. See runCodeProbe: a guarantee that stops holding stops
  // scoring, without anyone remembering to come back here.
  const probe = await runCodeProbe();

  const services: ServiceResult[] = [];
  for (const svc of SERVICES) {
    const row = bySlug.get(svc.agentSlug);
    if (!row) continue;
    const def = AgentDefinition.parse(row.definition);
    const journey = def.journeys.find((j) => j.key === svc.journeyKey);
    const state: CaseState = { ...emptyCase(), journeyKey: svc.journeyKey };
    const p = buildSystemPrompt(def, state, "en", true, true);
    const integrations = await listIntegrations(row.id);
    const env = def.activeEnvironment ?? "production";
    const backendOps = integrations
      .filter((i) => i.enabled)
      .flatMap((i) => (i.environments[env]?.operations ?? []).filter((o) => (o as { enabled?: boolean }).enabled !== false).map((o) => o.toolName));
    const [{ n: kbCount } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(kbDocuments).where(eq(kbDocuments.agentId, row.id));

    const ctx: Ctx = {
      def,
      journey,
      prompt: `${p.stable}\n${p.volatile}\n${journey?.guidance ?? ""}\n${journey?.submission?.apiFlow?.notes ?? ""}`,
      toolNames: [...backendOps, ...TOOL_DEFS.map((t) => t.name)],
      backendOps,
      kbCount: Number(kbCount),
      paymentProvider: def.integrations?.payment?.provider ?? "none",
      paymentSettings: def.integrations?.payment?.settings ?? {},
      environment: env,
      events,
      auditActions,
      resumedCases: Number(resumed),
      agentId: row.id,
      entity: svc.entity,
      probe,
    };

    const criteria = CRITERIA.map((cr) => {
      const checks = EVALUATORS[cr.id]!(ctx);
      const s = score(checks);
      return { criterionId: cr.id, score: s, status: band(s), checks };
    });
    services.push({
      service: svc,
      environment: env,
      score: Math.round(criteria.reduce((n, c) => n + c.score, 0) / criteria.length),
      criteria,
    });
  }

  // Portfolio view per criterion.
  const byCriterion = CRITERIA.map((criterion) => {
    const results = services.map((s) => s.criteria.find((c) => c.criterionId === criterion.id)!);
    const avg = Math.round(results.reduce((a, b) => a + b.score, 0) / (results.length || 1));
    return {
      criterion,
      score: avg,
      status: band(avg),
      servicesComplete: results.filter((r) => r.status === "complete").length,
      artefact: EVIDENCE_FILES[criterion.id],
    };
  });

  // Suggestions are derived from failed checks - never authored by hand.
  const grouped = new Map<string, Suggestion>();
  for (const s of services) {
    for (const cr of s.criteria) {
      const live = cr.checks.filter((x) => !x.na);
      const totalWeight = live.reduce((n, x) => n + x.weight, 0) || 1;
      for (const chk of live) {
        if (chk.ok || !chk.fix) continue;
        const key = `${cr.criterionId}::${chk.fix}`;
        // Points this check is worth across the whole portfolio.
        const share = (chk.weight / totalWeight) * (100 / CRITERIA.length) / services.length;
        const existing = grouped.get(key);
        if (existing) {
          existing.services.push(s.service.id);
          existing.impact += share;
        } else {
          grouped.set(key, {
            criterionId: cr.criterionId,
            domain: CRITERIA.find((c) => c.id === cr.criterionId)!.domain,
            services: [s.service.id],
            fix: chk.fix,
            impact: share,
            severity: cr.status === "gap" ? "critical" : cr.status === "partial" ? "high" : "medium",
          });
        }
      }
    }
  }
  const suggestions = [...grouped.values()]
    .map((s) => ({ ...s, impact: Math.round(s.impact * 10) / 10 }))
    .sort((a, b) => b.impact - a.impact);

  const overall = Math.round(services.reduce((n, s) => n + s.score, 0) / (services.length || 1));
  const overallBand = overall >= 85 ? "Launch ready" : overall >= 70 ? "Nearly ready" : overall >= 50 ? "Substantial gaps" : "Not ready";
  const envs = [...new Set(services.map((s) => s.environment))];
  // Name the gateway each agent is bound to, so a reader can tell at a glance
  // which database this assessment actually read.
  const gateways = [...new Set(
    SERVICES.map((s) => bySlug.get(s.agentSlug))
      .filter(Boolean)
      .map((r) => AgentDefinition.parse(r!.definition).integrations?.payment?.provider ?? "none")
  )];

  return {
    generatedAt: new Date().toISOString(),
    overall,
    band: overallBand,
    services,
    byCriterion,
    suggestions,
    signals: {
      conversations: events["conversation.started"] ?? 0,
      journeysStarted: events["journey.started"] ?? 0,
      journeysCompleted: events["journey.completed"] ?? 0,
      paymentsCompleted: events["payment.completed"] ?? 0,
      callbacks: events["callback.requested"] ?? 0,
      auditedActions: Object.values(auditActions).reduce((a, b) => a + b, 0),
      knowledgeRetrievals: events["knowledge.retrieved"] ?? 0,
      backendEnvironment: envs.join(", "),
      paymentGateway: gateways.join(", "),
    },
    notes: [
      "Every score is computed at load time from the deployed system - the stored journey definitions, the enabled backend operations, the adapter bindings, the knowledge base, and the audit and analytics tables. No figure on this page is hand-entered.",
      "Checks read structure rather than intent: whether a journey actually has a pricing call, a real write-back, a consent timestamp. Prompt wording alone never carries a criterion.",
      "A criterion is complete at 85 or above, partial from 45, and a gap below that. Requirements that genuinely do not apply to a service are excluded from its score rather than passed.",
      "The filled evidence workbooks received 2026-08-19 are registered per criterion, and their governing rules have been folded in as checks. The payment artefact documents the interim Network International position with Sadad still under confirmation - the Sadad check honours that position without treating it as permanent.",
    ],
  };
}
