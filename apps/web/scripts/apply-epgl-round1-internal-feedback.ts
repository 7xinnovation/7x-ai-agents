/**
 * Applies the EPGL "Round 1 - Internal" feedback export (2026-07-28) — the
 * items not already covered by the earlier round-1/round-2 scripts. Map:
 *
 *  FB-1434 greeting presents the services as tappable buttons, not prose.
 *  FB-1436 the first document is "Trade License / Initial Approval" (never
 *          "Trade / Postal License") — an Initial Approval is acceptable.
 *  FB-1441 an Initial Approval's number is captured in its own field
 *          (initial_approval_number), never as the trade license number
 *          (enforced in extract.ts too).
 *  FB-1448 renewal label "New trade license expiry date" → "Trade license
 *          expiry date".
 *  FB-1421 the full required-items list is shown ONCE up front so the customer
 *          can prepare, then documents are still collected one at a time.
 *  FB-1328 name + email are captured at the start; sign-in is offered before
 *          submission and a UAE PASS email overrides the typed one.
 *  FB-1422 corporate owners never get nationality/passport asked or shown.
 *  FB-1443/1449/1451/1452/1454/1455 uploads are TYPE-validated server-side; the
 *          agent must relay rejections and never proceed past a rejected
 *          mandatory document (validation itself is in extract.ts + upload).
 *  FB-1450 the declaration checkbox label links to the full declaration text
 *          (/declaration/epgl) so the applicant can read before agreeing.
 *  FB-1423/1444 completion shows the APPLICATION reference (license request) +
 *          next steps (review SLA, payment trigger, license delivery).
 *
 * Idempotent (marker-guarded / replace-or-skip). Run from apps/web:
 *   npx tsx scripts/apply-epgl-round1-internal-feedback.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

// Review SLA quoted to customers (FB-1423). Business constant — confirm the
// official figure with EPGL and keep the KB FAQ (add-epgl-journey-faq.ts) in sync.
const REVIEW_SLA_EN = "2 business days";
const REVIEW_SLA_AR = "يومي عمل";

const MARKER = "ROUND-1-INTERNAL FEEDBACK RULES";

const t = (en: string, ar: string) => ({ en, ar });

const GREETING = t(
  "Hello, I'm EPGL Dialog. Here's what I can help you with:\n\n```buttons\n- Apply for a new courier license\n- Renew an existing license\n- Ask a licensing question\n```",
  "مرحباً، أنا EPGL Dialog. إليك ما يمكنني مساعدتك به:\n\n```buttons\n- التقدم بطلب رخصة بريد سريع جديدة\n- تجديد رخصة قائمة\n- سؤال عن الترخيص\n```"
);

// FB-1450: the declaration checkbox label becomes a link to the full text.
const DECL_FIND =
  "one line `- declaration_accepted: <'I have read and agree to the Declaration and Undertaking' in the session language>`";
const DECL_REPL =
  "one line `- declaration_accepted: <a markdown link, in the session language: [I have read and agree to the Declaration and Undertaking](/declaration/epgl)>` — the label MUST be that link so the customer can open and read the full declaration text before agreeing";

// FB-1421 + FB-1328 + FB-1436/1441: journey opening for a new license.
const ISSUANCE_STEP1_FIND =
  "1) Collect the documents one at a time, in this order, each with its own ```upload block: first the TRADE LICENSE (key: trade_license) — this is a NEW postal activity license application, so the customer has NO postal license yet: ask only for the Trade License and NEVER call it 'Trade / Postal License' or mention a postal license upload — then the Memorandum of Association (key: moa).";
const ISSUANCE_STEP1_REPL =
  "0) START (before any upload): capture the customer's NAME and EMAIL in one short question and record them with collect_field (contact_name, contact_email). Then show — ONCE — the full list of what they should have ready, as short bullets: the Trade License (or the Initial Approval if the trade license is not yet issued), the Memorandum of Association, the owner's Emirates ID (typed or uploaded), and an in-chat Declaration & Undertaking checkbox at the end. This is preparation only: after the list, still collect ONE document at a time.\n" +
  "1) Collect the documents one at a time, in this order, each with its own ```upload block: first the TRADE LICENSE OR INITIAL APPROVAL (key: trade_license) — this is a NEW postal activity license application, so the customer has NO postal license yet: NEVER call it 'Trade / Postal License' or mention a postal license upload. An INITIAL APPROVAL is an acceptable alternative when the trade license has not yet been issued: its approval/reference number is captured as initial_approval_number (NEVER as the trade license number — the trade license number stays pending until the license is issued). Then the Memorandum of Association (key: moa).";

// FB-1423 + FB-1444: completion for a new license.
const ISSUANCE_END_FIND = "Then continue to duplicate-check and submission as before.";
const ISSUANCE_END_REPL =
  "Then continue to duplicate-check and submission as before.\n" +
  "COMPLETION (after a successful submit): call epglsalesforce__getRequestStatus with the NEW LICENSE REQUEST id from the submit response and present the customer their APPLICATION reference — the license request number — clearly labelled as the application reference for their NEW POSTAL ACTIVITY LICENSE APPLICATION. NEVER present a payment reference, an Account id, or any other record as the application reference. Then show 'What happens next' as three short bullets: 1) the EPGL team reviews the documents (typically within " +
  REVIEW_SLA_EN +
  " — in Arabic: خلال " +
  REVIEW_SLA_AR +
  " تقريباً); 2) once approved, a payment request is issued and paid through the secure payment gateway; 3) after payment, the license is issued and shared with the customer. Offer to check the status any time.";

const RENEWAL_END_FIND = "Then continue with the renewal submission (terms, finance summaries) as before.";
const RENEWAL_END_REPL =
  "Then continue with the renewal submission (terms, finance summaries) as before.\n" +
  "COMPLETION (after a successful submit): call epglsalesforce__getRequestStatus with the LICENSE REQUEST id from the submit response and present the customer their RENEWAL application reference (the license request number) — never a payment reference or another record's id. Then show 'What happens next': 1) document review by the EPGL team (typically within " +
  REVIEW_SLA_EN +
  "); 2) once approved, a payment request is issued through the secure payment gateway; 3) the renewed license is issued after payment. Offer to check the status any time.";

// Appended to both journeys (marker-guarded).
const ROUND_COMMON = [
  `${MARKER} (2026-07-28):`,
  "- DOCUMENT TYPE VALIDATION: every upload is automatically CLASSIFIED and validated server-side. A file that is not the requested document type (another document, a business card, a random file) is REJECTED with the reason shown on the upload widget, and NONE of its data is applied. When that happens: explain the rejection reason in one plain sentence, re-emit that document's ```upload block, and NEVER confirm receipt of a document that was rejected. Never say a document was received unless the case state shows it as uploaded.",
  "- NEVER PROCEED PAST A FAILED DOCUMENT: while a mandatory document is rejected or missing, do not move to later steps, the declaration, or submission — readiness blocks submission server-side, so resolve the document first.",
  "- CORPORATE OWNERS: when the primary owner/partner is a COMPANY (corporate shareholder), nationality, passport and Emirates ID do not apply to it — never ask for them, never display a nationality for a corporate owner, and leave those fields for the individual signatory where the journey needs one.",
  "- SIGN-IN BEFORE SUBMISSION: before submitting, offer the customer sign-in (UAE PASS where available) so the application is linked to their account. If UAE PASS provides a verified email, record it with collect_field over any earlier typed email (the UAE PASS contact details win).",
  "- EXTRACTED-VALUE CORRECTIONS: captured values show in the application panel with an edit (pencil) control — if the customer says a captured value is wrong, they can fix it there, or tell you the correction and you record it with collect_field.",
].join("\n");

function replaceOnce(name: string, guidance: string, find: string, repl: string, warnings: string[]): string {
  if (guidance.includes(repl)) return guidance;
  if (!guidance.includes(find)) {
    warnings.push(`  ! ${name}: target not found: "${find.slice(0, 70)}..."`);
    return guidance;
  }
  return guidance.replace(find, repl);
}

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog not found");
  const def = agent.definition as Record<string, any>;
  const warnings: string[] = [];
  const J = (key: string) => def.journeys.find((j: any) => j.key === key);
  const issuance = J("new_license");
  const renewal = J("renewal");
  if (!issuance || !renewal) throw new Error("expected new_license + renewal journeys");

  // ── FB-1434: greeting with tappable service buttons ──
  def.greeting = GREETING;

  // ── FB-1436: first document is "Trade License / Initial Approval" ──
  const docsStep = issuance.steps.find((s: any) => s.documents?.length);
  const tl = docsStep?.documents.find((d: any) => d.key === "trade_license");
  if (tl) tl.label = t("Trade License / Initial Approval", "الرخصة التجارية / الموافقة المبدئية");
  else warnings.push("  ! new_license: trade_license document not found");

  // ── FB-1441: the Initial Approval number gets its own (optional) field ──
  const companyStep = issuance.steps.find((s: any) => s.key === "company_details");
  if (companyStep && !companyStep.fields.some((f: any) => f.key === "initial_approval_number")) {
    const idx = companyStep.fields.findIndex((f: any) => f.key === "trade_license_number");
    companyStep.fields.splice(Math.max(idx + 1, 0), 0, {
      key: "initial_approval_number",
      type: "text",
      label: t("Initial approval number", "رقم الموافقة المبدئية"),
      validation: { required: false },
    });
  }

  // ── FB-1448: "New trade license expiry date" → "Trade license expiry date" ──
  for (const s of renewal.steps)
    for (const f of s.fields ?? [])
      if (f.key === "license_expiry_date") f.label = t("Trade license expiry date", "تاريخ انتهاء الرخصة التجارية");

  // ── Guidance: issuance ──
  let ig: string = issuance.guidance ?? "";
  ig = replaceOnce("new_license", ig, ISSUANCE_STEP1_FIND, ISSUANCE_STEP1_REPL, warnings);
  ig = replaceOnce("new_license", ig, DECL_FIND, DECL_REPL, warnings);
  ig = replaceOnce("new_license", ig, ISSUANCE_END_FIND, ISSUANCE_END_REPL, warnings);
  if (!ig.includes(MARKER)) ig += `\n\n${ROUND_COMMON}`;
  issuance.guidance = ig;

  // ── Guidance: renewal ──
  let rg: string = renewal.guidance ?? "";
  rg = replaceOnce("renewal", rg, DECL_FIND, DECL_REPL, warnings);
  rg = replaceOnce("renewal", rg, RENEWAL_END_FIND, RENEWAL_END_REPL, warnings);
  if (!rg.includes(MARKER)) {
    rg +=
      `\n\n${ROUND_COMMON}\n` +
      "- PREPARATION LIST: at the start of a renewal, show once what the customer should have ready: the postal license number, the current trade / postal license (upload), optionally the quarterly financial statement, and the in-chat declaration & terms checkboxes at the end.";
  }
  renewal.guidance = rg;

  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));

  console.log("EPGL Round-1-internal feedback applied:");
  console.log(`  greeting has buttons: ${/```buttons/.test(def.greeting.en)}`);
  console.log(`  trade_license label: ${JSON.stringify(tl?.label?.en)}`);
  console.log(`  initial_approval_number present: ${companyStep?.fields.some((f: any) => f.key === "initial_approval_number")}`);
  console.log(`  new_license guidance: ${issuance.guidance.length} chars; renewal: ${renewal.guidance.length} chars`);
  if (warnings.length) {
    console.log("Warnings (check for drift):");
    for (const w of warnings) console.log(w);
  } else console.log("All replacement targets matched.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
