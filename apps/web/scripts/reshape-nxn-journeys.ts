/**
 * Applies Round-1 feedback (feedback-export-2026-07-09) to the NXN agent's four
 * PO Box journeys, following the attached journey docs in ~/Downloads/nxn-agent:
 *   FB-1190 Rent Individual   → rent_personal.docx
 *   FB-1191 Rent Corporate    → rent_corporate.docx
 *   FB-1192 Renew Corporate   → renew_corporate.docx
 *   FB-1193 Renew Individual  → renew_personal.docx
 *   FB-1168 Renew auto-renew: check status on sign-in, auto-renew when enabled +
 *           saved card, else run the journey and capture save-card + auto-renew
 *           consent and mark auto-renew active.
 *   FB-1169 present products/options as CARDS not tables (prompt-level, global).
 *
 * Each journey keeps its working amount + integration tools; this reshapes the
 * collected fields and adds a per-journey `guidance` playbook. Auto-renew and
 * save-card consent are captured as fields so they land in the case + payload.
 *
 * Round 2 (gap closure against the same docs):
 *   - Renewals require UAE PASS sign-in (docs: UAE PASS is the ONLY renewal auth;
 *     FB-1168 "ask to login") — journey + intent requiresAuth flipped to true.
 *   - Rent journeys: agent EID front/back upload slots (mandatory once the
 *     customer opts to add an agent) with vision extraction as the primary path
 *     for the agent's name / ID number / expiry; manual entry is the fallback.
 *
 * Run: npx tsx scripts/reshape-nxn-journeys.ts   (from apps/web)
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

type L = { en: string; ar: string };
const t = (en: string, ar: string): L => ({ en, ar });

function field(key: string, en: string, ar: string, opts: { type?: string; required?: boolean; options?: { value: string; label: L }[] } = {}) {
  return {
    key,
    type: opts.type ?? "text",
    label: t(en, ar),
    validation: { required: opts.required ?? true },
    ...(opts.options ? { options: opts.options } : {}),
  };
}
const yesNo = [
  { value: "yes", label: t("Yes", "نعم") },
  { value: "no", label: t("No", "لا") },
];
const emirateOpts = [
  { value: "AUH", label: t("Abu Dhabi", "أبوظبي") },
  { value: "DXB", label: t("Dubai", "دبي") },
  { value: "SHJ", label: t("Sharjah", "الشارقة") },
  { value: "AJM", label: t("Ajman", "عجمان") },
  { value: "UAQ", label: t("Umm Al Quwain", "أم القيوين") },
  { value: "RAK", label: t("Ras Al Khaimah", "رأس الخيمة") },
  { value: "FUJ", label: t("Fujairah", "الفجيرة") },
];
const durationOpts = [
  { value: "1_YEAR", label: t("1 year", "سنة واحدة") },
  { value: "2_YEAR", label: t("2 years", "سنتان") },
];
// Shared consent fields (feedback FB-1168 / "auto renew checked if consented").
const consentFields = [
  field("save_card_consent", "Consent to save card for future payments (yes/no)", "الموافقة على حفظ البطاقة (نعم/لا)", { type: "boolean", required: false }),
  field("auto_renew_consent", "Consent to enable auto-renewal (yes/no)", "الموافقة على التجديد التلقائي (نعم/لا)", { type: "boolean", required: false }),
];
// Agent EID uploads (docs Stage "Add Agent": front + back required once the
// customer opts in; extraction is the primary path, manual entry the fallback).
const agentEidDocs = [
  { key: "agent_eid_front", label: t("Agent Emirates ID (front)", "الهوية الإماراتية للوكيل (الوجه الأمامي)"), requirement: "mandatory", condition: "add_agent == 'yes'", acceptedFormats: ["png", "jpg", "jpeg", "pdf"], maxSizeMb: 10 },
  { key: "agent_eid_back", label: t("Agent Emirates ID (back)", "الهوية الإماراتية للوكيل (الوجه الخلفي)"), requirement: "mandatory", condition: "add_agent == 'yes'", acceptedFormats: ["png", "jpg", "jpeg", "pdf"], maxSizeMb: 10 },
];

const CARDS_RULE =
  "Whenever you present bundles, branches, available box numbers, durations or add-ons for the customer to choose from, show them as CARDS (a ```cards fenced block), never as a table.";

const PAYMENT_CONSENT =
  "At payment: if a saved card is on file, use it directly; otherwise capture the card via the payment gateway. Before charging, ask the customer (a) to consent to save the card for future payments and (b) to enable auto-renewal — auto-renew is an existing checkbox sent in the API payload and confirmed on screen. Record save_card_consent and auto_renew_consent with collect_field, and if auto-renew is consented, mark auto-renew ACTIVE in the submission. Never enable auto-renew without explicit consent.";

const RENT_PERSONAL_GUIDANCE = [
  "Follow the Rent Personal PO Box journey.",
  "Entry: the customer signs in with UAE PASS (name, Emirates ID, EID expiry come from the profile — do not ask for an identity upload). For a returning customer, pre-fill bundle, branch and duration from their prior choices where known and shortcut the steps.",
  "Stage 1 Selection: 1) present bundle types, 2) ask Emirate, 3) show branches for that Emirate, 4) show 10 available numbers with a Refresh option (next 10), 5) ask rental duration in years. " + CARDS_RULE,
  "Stage 2 Add Agent (OPTIONAL): ask 'Add an agent to this PO Box?' and record add_agent. If yes, ask the customer to upload the agent's Emirates ID front AND back in the two upload slots that appear (agent_eid_front, agent_eid_back — both sides required). The uploads are read automatically and the agent's full name, ID number and EID expiry are extracted to pre-fill the fields — present the extracted details for confirmation (this is the PRIMARY path); only if extraction fails, collect them manually. Then ask agent email + phone. If the EID is expired or invalid/unreadable (after one retry), tell the customer the agent can be added later from the PO Box management page, set add_agent to 'no', and proceed with NO agent — never block the customer.",
  "Stage 3 Key Delivery (OPTIONAL): ask 'Deliver the key to an address?' (show its price). If no, default to branch collection. If yes and a registered address is on file, offer it; otherwise take the delivery address.",
  "Stage 4 Review & Confirm: summarise bundle, Emirate, branch, number, duration, price, agent (if added) and delivery (if chosen); let the customer edit any block, then confirm.",
  "Stage 5 Payment: " + PAYMENT_CONSENT,
  "Stage 6 Completion: confirm the PO Box is rented, then offer receipt, tax invoice, email confirmation and related services.",
].join("\n");

const RENT_CORPORATE_GUIDANCE = [
  "Follow the Rent Corporate PO Box journey. The signed-in UAE PASS customer MUST be the owner; non-owners cannot proceed.",
  "Stage 1 Selection (same as personal): bundle, Emirate, branch, 10 available numbers + Refresh, duration. " + CARDS_RULE,
  "Stage 2 Trade License verification (three tiers): Tier 1 — ask the issuing entity, then GSB-check whether the customer's EID matches an owner ID under that entity; one company → use it, multiple → let the customer pick. Tier 2 — if none found, ask for the trade license number and re-check the EID against the owner ID on that license. Tier 3 — if still no match or not found, ask the customer to upload the trade license copy and route into the existing form-based manual validation (Salesforce case, flagged pending validation). The GSB EID-to-owner match IS the ownership check on Tiers 1 and 2.",
  "Stage 2A: after a Tier 1/Tier 2 match, show the company's existing corporate PO Boxes before creating a new one, to avoid duplicates.",
  "Stage 3 Company Address: capture the company address.",
  "Stage 4 Add Agent (OPTIONAL): same as the personal journey — record add_agent; if yes, the agent's Emirates ID front AND back are uploaded (agent_eid_front, agent_eid_back) and auto-extracted to pre-fill name / ID number / expiry (confirm with the customer; manual entry only if extraction fails), then email + phone. Expired or invalid EID → set add_agent to 'no' and proceed with no agent.",
  "Stage 5 Key Delivery (OPTIONAL): offer the company address, or take a different delivery address.",
  "Stage 6 Review & Confirm: summarise everything and let the customer edit before payment.",
  "Stage 7 Payment (taken on both the auto-verified and manual paths): " + PAYMENT_CONSENT,
  "Stage 8 Completion: on the verified path confirm the box is rented. On the Tier 3 manual path, do NOT say 'rented' — tell the customer their documents are being validated and confirmation follows once validated.",
].join("\n");

const RENEW_AUTO_RENEW = [
  "Auto-renewal (feedback FB-1168): after identifying the box, read its current auto-renewal status and whether a card is saved. If auto-renew is already ENABLED and a card is on file, tell the customer their box is set to renew automatically and offer to process the renewal now on the saved card — a simple confirm, no re-entry. If auto-renew is OFF or no card is saved, run the renewal journey and, at payment, ask for consent to save the card and to enable auto-renewal; if consented, mark auto-renew ACTIVE in the system. Never enable auto-renew without explicit consent.",
].join("\n");

const RENEW_AUTH =
  "Entry: renewal is available to GUESTS and signed-in customers alike. OFFER UAE PASS sign-in (feedback FB-1168: 'ask to login') because signing in lets you check and turn on auto-renewal and pre-fill the customer's box, but NEVER require it: if the customer wants to continue as a guest, proceed with the renewal and collect the PO Box number and details directly. Do not call request_authentication for a renewal. When the customer IS signed in, use the known customer record to pre-select their box instead of asking from scratch.";

const RENEW_PERSONAL_GUIDANCE = [
  "Follow the Renew Personal PO Box journey. Renewal extends the existing box on the SAME bundle (changing bundle/branch/agent/delivery is out of scope here).",
  RENEW_AUTH + " " + RENEW_AUTO_RENEW,
  "Stage 1 Retrieve & Confirm: show the box number, branch, current bundle and expiry, plus auto-renew and agent status; confirm which box to renew. " + CARDS_RULE,
  "Stage 2 Renewal Terms: confirm same-bundle renewal and ask the renewal duration in years (default to prior duration where known).",
  "Stage 3 Summary & Confirm: summarise box, branch, bundle, duration, new expiry date, price and any fees; the customer confirms.",
  "Stage 4 Payment: " + PAYMENT_CONSENT,
  "Stage 5 Completion: confirm the box is renewed and show the new expiry date, then offer receipt, tax invoice and related services.",
].join("\n");

const RENEW_CORPORATE_GUIDANCE = [
  "Follow the Renew Corporate PO Box journey. Same-bundle renewal only; the customer must be the owner. The corporate addition is a trade-license validity check.",
  RENEW_AUTH + " " + RENEW_AUTO_RENEW,
  "Stage 1 Retrieve & Confirm: show the company's corporate boxes with bundle, expiry, auto-renew and agent status; the customer picks which box to renew. " + CARDS_RULE,
  "Stage 2 Trade License validity: if the license on file is valid, proceed. If it is expired or near expiry, re-route to the existing form-based validation (Salesforce case, pending-validation completion) — mirroring the corporate rental Tier 3 handoff. Renewal payment is still taken; the box is renewed only once documents are validated.",
  "Stage 3 Renewal Terms: confirm same-bundle renewal and ask the renewal duration in years.",
  "Stage 4 Summary & Payment (taken on both the valid-TL and re-route paths): " + PAYMENT_CONSENT,
  "Stage 5 Completion: on the valid-TL path confirm renewed + show the new expiry. On the re-route path do NOT say 'renewed' — tell the customer documents are being validated and confirmation follows.",
].join("\n");

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  const def = agent.definition as Record<string, any>;
  const J = (key: string) => def.journeys.find((j: any) => j.key === key);

  // ── Rent Personal ──
  const rp = J("personal_po_box_rental");
  rp.guidance = RENT_PERSONAL_GUIDANCE;
  rp.steps = [
    { key: "selection", title: t("Selection", "الاختيار"), requiresAuth: false, documents: [], fields: [
      field("package", "Bundle type", "نوع الباقة", { type: "enum", options: [
        { value: "MYBOX", label: t("MyBox", "ماي بوكس") }, { value: "MYHOME", label: t("MyHome", "ماي هوم") }, { value: "MYHOME_INSTANT", label: t("MyHome Instant", "ماي هوم إنستانت") },
      ] }),
      field("emirate", "Emirate", "الإمارة", { type: "enum", options: emirateOpts }),
      field("branch", "Branch", "الفرع"),
      field("box_number", "Selected box number", "رقم الصندوق المختار"),
      field("duration", "Rental duration", "مدة الإيجار", { type: "enum", options: durationOpts }),
    ] },
    { key: "agent", title: t("Authorized agent (optional)", "الوكيل المفوّض (اختياري)"), requiresAuth: false, documents: agentEidDocs, fields: [
      field("add_agent", "Add an authorized agent?", "إضافة وكيل مفوّض؟", { type: "enum", required: false, options: yesNo }),
      field("agent_full_name", "Agent full name", "اسم الوكيل", { required: false }),
      field("agent_emirates_id", "Agent Emirates ID number", "رقم الهوية الإماراتية للوكيل", { required: false }),
      field("agent_eid_expiry", "Agent Emirates ID expiry", "تاريخ انتهاء هوية الوكيل", { type: "date", required: false }),
      field("agent_email", "Agent email", "بريد الوكيل", { type: "email", required: false }),
      field("agent_phone", "Agent phone", "هاتف الوكيل", { type: "phone", required: false }),
    ] },
    { key: "delivery", title: t("Key delivery (optional)", "توصيل المفتاح (اختياري)"), requiresAuth: false, documents: [], fields: [
      field("key_delivery", "Deliver the key or collect from branch?", "توصيل المفتاح أم الاستلام من الفرع؟", { type: "enum", required: false, options: [
        { value: "branch_pickup", label: t("Collect from branch", "الاستلام من الفرع") }, { value: "deliver", label: t("Deliver to address", "التوصيل إلى عنوان") },
      ] }),
      field("delivery_address", "Delivery address", "عنوان التوصيل", { type: "longtext", required: false }),
    ] },
    { key: "contact", title: t("Contact & consent", "التواصل والموافقة"), requiresAuth: false, documents: [], fields: [
      field("contact_phone", "Contact phone", "رقم الهاتف", { type: "phone" }),
      field("contact_email", "Contact email", "البريد الإلكتروني", { type: "email" }),
      ...consentFields,
    ] },
  ];

  // ── Rent Corporate ──
  const rc = J("corporate_po_box_rental");
  rc.guidance = RENT_CORPORATE_GUIDANCE;
  rc.steps = [
    { key: "selection", title: t("Selection", "الاختيار"), requiresAuth: false, documents: [], fields: [
      field("package", "Bundle type", "نوع الباقة", { type: "enum", options: [
        { value: "BASIC", label: t("Basic", "أساسي") }, { value: "PREMIUM", label: t("Premium", "بريميوم") }, { value: "PREMIUM_PLUS", label: t("Premium Plus", "بريميوم بلس") },
      ] }),
      field("emirate", "Emirate", "الإمارة", { type: "enum", options: emirateOpts }),
      field("branch", "Branch", "الفرع"),
      field("box_number", "Selected box number", "رقم الصندوق المختار"),
      field("duration", "Rental duration", "مدة الإيجار", { type: "enum", options: durationOpts }),
    ] },
    { key: "verification", title: t("Trade license verification", "التحقق من الرخصة التجارية"), requiresAuth: false, documents: [
      { key: "trade_license", label: t("Trade license copy (Tier 3 only)", "نسخة الرخصة التجارية (المستوى الثالث فقط)"), requirement: "optional", acceptedFormats: ["pdf", "png", "jpg"], maxSizeMb: 10 },
    ], fields: [
      field("issuing_authority", "Trade license issuing entity", "جهة إصدار الرخصة"),
      field("trade_license_number", "Trade license number", "رقم الرخصة التجارية", { required: false }),
      field("company_name", "Company name", "اسم الشركة", { required: false }),
    ] },
    { key: "company", title: t("Company address", "عنوان الشركة"), requiresAuth: false, documents: [], fields: [
      field("company_address", "Company address", "عنوان الشركة", { type: "longtext" }),
    ] },
    { key: "agent", title: t("Authorized agent (optional)", "الوكيل المفوّض (اختياري)"), requiresAuth: false, documents: agentEidDocs, fields: [
      field("add_agent", "Add an authorized agent?", "إضافة وكيل مفوّض؟", { type: "enum", required: false, options: yesNo }),
      field("agent_full_name", "Agent full name", "اسم الوكيل", { required: false }),
      field("agent_emirates_id", "Agent Emirates ID number", "رقم الهوية الإماراتية للوكيل", { required: false }),
      field("agent_eid_expiry", "Agent Emirates ID expiry", "تاريخ انتهاء هوية الوكيل", { type: "date", required: false }),
      field("agent_email", "Agent email", "بريد الوكيل", { type: "email", required: false }),
      field("agent_phone", "Agent phone", "هاتف الوكيل", { type: "phone", required: false }),
    ] },
    { key: "delivery", title: t("Key delivery & consent", "توصيل المفتاح والموافقة"), requiresAuth: false, documents: [], fields: [
      field("key_delivery", "Deliver the key or collect from branch?", "توصيل المفتاح أم الاستلام من الفرع؟", { type: "enum", required: false, options: [
        { value: "branch_pickup", label: t("Collect from branch", "الاستلام من الفرع") }, { value: "deliver", label: t("Deliver to address", "التوصيل إلى عنوان") },
      ] }),
      field("delivery_address", "Delivery address", "عنوان التوصيل", { type: "longtext", required: false }),
      field("contact_email", "Contact email", "البريد الإلكتروني", { type: "email" }),
      ...consentFields,
    ] },
  ];

  // ── Renew Personal ── (keep apiFlow details/pricing; add consent + guidance)
  const rnp = J("personal_po_box_renewal");
  rnp.guidance = RENEW_PERSONAL_GUIDANCE;
  rnp.requiresAuth = false; // renewal is guest-allowed; sign-in is offered, not required (FB-1168)
  rnp.steps = [
    { key: "identify", title: t("Identify & terms", "التحديد والشروط"), requiresAuth: false, documents: [], fields: [
      field("po_box_number", "PO Box number", "رقم صندوق البريد"),
      field("renewal_period", "Renewal duration", "مدة التجديد", { type: "enum", options: durationOpts }),
      field("updated_phone", "Contact phone", "رقم الهاتف", { type: "phone", required: false }),
      ...consentFields,
    ] },
  ];

  // ── Renew Corporate ── (keep apiFlow; add TL check + consent + guidance)
  const rnc = J("corporate_po_box_renewal");
  rnc.guidance = RENEW_CORPORATE_GUIDANCE;
  rnc.requiresAuth = false; // renewal is guest-allowed; sign-in is offered, not required (FB-1168)
  rnc.steps = [
    { key: "identify", title: t("Identify & terms", "التحديد والشروط"), requiresAuth: false, documents: [], fields: [
      field("po_box_number", "PO Box number", "رقم صندوق البريد"),
      field("trade_license_number", "Trade license number", "رقم الرخصة التجارية"),
      field("renewal_period", "Renewal duration", "مدة التجديد", { type: "enum", options: durationOpts }),
      field("contact_email", "Contact email", "البريد الإلكتروني", { type: "email", required: false }),
      ...consentFields,
    ] },
  ];

  // Renewal is guest-allowed: the intents do NOT require sign-in (the guidance
  // still offers UAE PASS for auto-renew, but guests can renew).
  for (const key of ["renew_personal_pobox", "renew_corporate_pobox"]) {
    const intent = def.intents.find((i: any) => i.key === key);
    if (intent) intent.requiresAuth = false;
  }

  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));
  console.log("NXN journeys reshaped to the attached docs:");
  for (const k of ["personal_po_box_rental", "corporate_po_box_rental", "personal_po_box_renewal", "corporate_po_box_renewal"]) {
    const j = J(k);
    console.log(`  ${k}: ${j.steps.length} steps, ${j.steps.reduce((n: number, s: any) => n + s.fields.length, 0)} fields, guidance ${j.guidance.length} chars`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
