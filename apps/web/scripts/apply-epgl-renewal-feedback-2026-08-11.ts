/**
 * Applies the "Renewal AI Process Feedback" round (2026-08-11), EPGL renewal:
 *
 *   1  Batch document uploads — a single list of every required document with
 *      its own upload control, instead of one prompt at a time.
 *   2  Stronger validation + cross-checking — a Form 9 must not pass as a trade
 *      licence, and a document belonging to another company must be refused.
 *      (Taxonomy + entity cross-check live in the code; this adds the agent's
 *      half: it must never talk past a rejection.)
 *   4  UAE phone formatting — strict pattern on every phone field.
 *   6  Finance summary — the four quarters run from the LICENCE PERIOD start,
 *      not calendar Q1, and the figures are read off the Form 9 for the customer
 *      to confirm or correct rather than typed in one at a time.
 *   7  Financial year — the year of the FIRST quarter of the licensing period.
 *   8  Revenue documents — AFS and acknowledgement letter captured, as the
 *      control for audit completion on partially closed requests.
 *
 * Items 3 (OTP on email/phone) and 5 (response time) are not covered here — see
 * the notes at the end of this file.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/apply-epgl-renewal-feedback-2026-08-11.ts
 *   prod: DATABASE_URL=<Railway DATABASE_PUBLIC_URL> npx tsx scripts/...
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const MARKER = "RENEWAL PROCESS FEEDBACK (2026-08-11):";

type L = { en: string; ar: string };
const t = (en: string, ar: string): L => ({ en, ar });

// ── Item 4: UAE telecom digit standards ─────────────────────────────────────
// Mobile 05x xxx xxxx / +9715x xxxxxxx (5 followed by 0,2,4,5,6,8) and landline
// 0x xxx xxxx / +9714 xxxxxxx (2,3,4,6,7,9). Separators and a leading +971 or 0
// are tolerated on input; the shape underneath must be a real UAE number.
const UAE_PHONE = "^(?:(?:\\+|00)971[\\s-]?|0)(?:5[024568][\\s-]?\\d{3}[\\s-]?\\d{4}|[234679][\\s-]?\\d{3}[\\s-]?\\d{4})$";
const UAE_PHONE_MSG = t(
  "Enter a UAE number — mobile 05x xxx xxxx (or +9715x xxx xxxx) or landline 0x xxx xxxx.",
  "أدخل رقماً إماراتياً — متحرك 05x xxx xxxx (أو ‎+9715x xxx xxxx) أو أرضي 0x xxx xxxx."
);

// ── Item 8: the revenue documents that control audit completion ─────────────
const doc = (key: string, en: string, ar: string, requirement: "mandatory" | "optional") => ({
  key,
  label: t(en, ar),
  requirement,
  acceptedFormats: ["pdf", "png", "jpg"],
  maxSizeMb: 10,
});

const RENEWAL_DOCS = [
  doc("updated_trade_license", "Current trade / postal license", "الرخصة التجارية / البريدية الحالية", "mandatory"),
  doc("form_9", "Form 9 (postal revenue return)", "النموذج 9 (إقرار إيرادات البريد)", "mandatory"),
  doc("audited_financial_statement", "Audited Financial Statements (AFS)", "البيانات المالية المدققة", "mandatory"),
  doc("acknowledgement_letter", "Audit acknowledgement letter", "خطاب إقرار التدقيق", "optional"),
  doc("financial_statement", "Quarterly financial statement", "الإقرار المالي الربع سنوي", "optional"),
];

// ── Items 6 + 7: quarters run from the licence period, not the calendar ─────
const PERIOD_FIELDS = [
  {
    key: "license_period_start_quarter",
    label: t("Licensing period starts in quarter", "يبدأ ربع فترة الترخيص"),
    type: "enum",
    options: [
      { value: "Q1", label: t("Q1 (Jan–Mar)", "الربع الأول (يناير–مارس)") },
      { value: "Q2", label: t("Q2 (Apr–Jun)", "الربع الثاني (أبريل–يونيو)") },
      { value: "Q3", label: t("Q3 (Jul–Sep)", "الربع الثالث (يوليو–سبتمبر)") },
      { value: "Q4", label: t("Q4 (Oct–Dec)", "الربع الرابع (أكتوبر–ديسمبر)") },
    ],
    validation: { required: true },
    editable: false,
  },
];

// The four income fields keep their keys (the Salesforce mapping and every
// stored case depend on them) but stop pretending to be calendar quarters.
const QUARTER_LABELS: Record<string, L> = {
  leviable_income_q1: t("Leviable income — 1st quarter of the licensing period (AED)", "الدخل الخاضع للرسوم — الربع الأول من فترة الترخيص (درهم)"),
  leviable_income_q2: t("Leviable income — 2nd quarter of the licensing period (AED)", "الدخل الخاضع للرسوم — الربع الثاني من فترة الترخيص (درهم)"),
  leviable_income_q3: t("Leviable income — 3rd quarter of the licensing period (AED)", "الدخل الخاضع للرسوم — الربع الثالث من فترة الترخيص (درهم)"),
  leviable_income_q4: t("Leviable income — 4th quarter of the licensing period (AED)", "الدخل الخاضع للرسوم — الربع الرابع من فترة الترخيص (درهم)"),
};
const FINANCIAL_YEAR_LABEL = t(
  "Financial year (the year the licensing period's first quarter falls in)",
  "السنة المالية (سنة الربع الأول من فترة الترخيص)"
);

// ── Guidance ────────────────────────────────────────────────────────────────

const BATCH_UPLOAD_RULE =
  "- ALL DOCUMENTS AT ONCE: do NOT walk the customer through the documents one prompt at a time. In a single message, " +
  "list every document this renewal needs and emit an ```upload block for EACH of them in that same message, so the " +
  "customer sees the full set with an upload control beside each and can complete them in any order, batching as they " +
  "like. Mark clearly which are mandatory and which are optional. The system tells you after each file lands: " +
  "acknowledge briefly, never re-list the whole set, and only re-emit the blocks for what is still outstanding or was " +
  "rejected. Do not block the finance questions behind the uploads — the customer can be answering those while files " +
  "are still going up.";

const VALIDATION_RULE =
  "- A REJECTED DOCUMENT IS NOT RECEIVED: every upload is classified and cross-checked server-side. A file is refused " +
  "when it is the wrong KIND of document (a Form 9 is NOT a trade licence — it reports revenue, it does not license " +
  "anything), or when it is the right kind but belongs to a DIFFERENT company than the one on this application " +
  "(mismatched licence number or company name). When that happens the reason is shown on the upload control and NONE " +
  "of the file's data is applied: state the reason in one plain sentence, re-emit that document's ```upload block, and " +
  "never confirm receipt or move on. Never describe a rejected document as uploaded, and never carry a value from one.";

const PERIOD_RULE =
  "- QUARTERS FOLLOW THE LICENCE, NOT THE CALENDAR: a company's licensing period does not necessarily start in January, " +
  "so its four reporting quarters may run Q3, Q4, Q1, Q2. NEVER assume the first quarter is Q1 of a calendar year. " +
  "Work it out like this: take the licence period start from the licence you were given (or the Form 9), record which " +
  "quarter it starts in as license_period_start_quarter, and record financial_year as the YEAR THAT FIRST QUARTER " +
  "FALLS IN. The four income fields are then the 1st, 2nd, 3rd and 4th quarter OF THAT PERIOD in order — " +
  "leviable_income_q1 is the period's FIRST quarter whatever it is called on the calendar. Whenever you name a quarter " +
  "to the customer, name it in full with its calendar label and year (\"Q3 2023\", not \"Q1\"), and if they tell you " +
  "their first quarter is Q3 2023, take that as the period start and derive the rest — do not keep asking for \"Q1\". " +
  "If the licence gives you the start date, do not ask at all: state the four quarters you derived and ask them to " +
  "confirm.";

const FORM9_RULE =
  "- READ THE FIGURES, DO NOT DICTATE THEM: the quarterly leviable-income figures are printed on the Form 9. Once it is " +
  "uploaded, take the four figures from it, record them with collect_field, and present all four together in one " +
  "```summary block with each quarter's full calendar label — then ask a single question: are these correct, or does " +
  "anything need changing? Offer that as a ```buttons choice (confirm / change a figure). Only ask the customer to type " +
  "a figure that is genuinely missing from the Form 9 or that they want to correct. Never walk them through four " +
  "separate questions when the document already answers them.";

const REVENUE_DOCS_RULE =
  "- REVENUE DOCUMENTS ARE PART OF THE RENEWAL: the Form 9 and the Audited Financial Statements are MANDATORY, and the " +
  "audit acknowledgement letter is accepted when the customer has one — these are what let EPGL confirm the audit is " +
  "complete rather than leaving the request partially closed. Ask for them with the rest of the documents, and if the " +
  "customer asks why, explain plainly that the renewal cannot be completed without evidence of the audited revenue. " +
  "You may REQUEST, RECEIVE and READ a Form 9 — the guardrail on Form 09 is about not advising on how to complete or " +
  "interpret one, not about handling the document.";

const PHONE_RULE =
  "- PHONE NUMBERS: contact and accountant phone numbers must be UAE numbers — mobile 05x xxx xxxx (or +9715x xxx xxxx) " +
  "or a landline 0x xxx xxxx. If what the customer gives you is not one, say so plainly and ask for a UAE number; do " +
  "not record it and do not reformat a foreign number to look valid.";

const BLOCK = [MARKER, BATCH_UPLOAD_RULE, VALIDATION_RULE, PERIOD_RULE, FORM9_RULE, REVENUE_DOCS_RULE, PHONE_RULE].join("\n");

// Salesforce needs a real calendar quarter + year on each finance row; the
// journey now stores a period start, so spell out the derivation.
const APIFLOW_MARKER = "QUARTER DERIVATION (2026-08-11)";
const APIFLOW_NOTE =
  ` ${APIFLOW_MARKER}: EPG_Finance_Summary__c rows must carry the REAL calendar quarter and year, not the journey's ` +
  `field order. Start from license_period_start_quarter + financial_year and walk forward one quarter per row, rolling ` +
  `the year over after Q4: leviable_income_q1 -> the start quarter in financial_year, then q2, q3, q4 follow it. ` +
  `Example — start Q3, financial_year 2023: q1 = Quarter__c "Q3"/EPG_Year__c "2023" (Name "Q3 2023"), q2 = Q4/2023, ` +
  `q3 = Q1/2024, q4 = Q2/2024. Never emit four rows all labelled Q1..Q4 of the same year unless the period genuinely ` +
  `starts at Q1.`;

interface Field { key: string; label?: L; type?: string; validation?: Record<string, unknown>; editable?: boolean; options?: unknown[]; [k: string]: unknown }
interface Step { key: string; fields: Field[]; documents?: unknown[]; [k: string]: unknown }
interface Journey { key: string; guidance?: string; steps: Step[]; submission?: any; [k: string]: unknown }
interface Definition { journeys: Journey[]; uploadsPerMessage?: number; [k: string]: unknown }

// jsonb does not preserve key order, so a stringify comparison would report a
// difference on every run and the script would never settle.
const sameLabel = (a: unknown, b: L): boolean => {
  const x = a as L | undefined;
  return !!x && x.en === b.en && x.ar === b.ar;
};

function withBlock(guidance: string): string {
  const idx = guidance.indexOf(MARKER);
  if (idx === -1) return `${guidance.trimEnd()}\n\n${BLOCK}`;
  const after = guidance.slice(idx + MARKER.length).split("\n");
  let end = 0;
  for (let i = 1; i < after.length; i++) {
    const line = after[i]!;
    if (line.trim() === "" || line.startsWith("- ")) { end = i; continue; }
    break;
  }
  const base = guidance.slice(0, idx).trimEnd();
  const tail = after.slice(end + 1).join("\n").trim();
  return [`${base}\n\n${BLOCK}`, tail].filter(Boolean).join("\n\n");
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Definition;
  const changes: string[] = [];

  // Item 1 — the per-message upload cap has to go for a batch matrix. It stays
  // in place for the new-licence journey conceptually, but the setting is
  // agent-wide, so removing it is what the renewal feedback asks for.
  if (def.uploadsPerMessage !== undefined) {
    delete def.uploadsPerMessage;
    changes.push("item 1: uploadsPerMessage cap removed (batch document uploads)");
  }

  const renewal = def.journeys.find((j) => j.key === "renewal");
  if (!renewal) throw new Error("renewal journey missing");

  // Item 8 — the document matrix.
  const docStep = renewal.steps.find((s) => s.key === "documents");
  if (!docStep) throw new Error("renewal documents step missing");
  const existingDocs = (docStep.documents ?? []) as { key: string }[];
  if (JSON.stringify(existingDocs.map((d) => d.key)) !== JSON.stringify(RENEWAL_DOCS.map((d) => d.key))) {
    docStep.documents = RENEWAL_DOCS;
    changes.push(`item 8: renewal documents = ${RENEWAL_DOCS.map((d) => d.key).join(", ")}`);
  }

  const financeStep = renewal.steps.find((s) => s.key === "finance");
  if (!financeStep) throw new Error("renewal finance step missing");

  // Items 6 + 7 — period start field, quarter labels, financial-year meaning.
  for (const pf of PERIOD_FIELDS) {
    if (!financeStep.fields.some((f) => f.key === pf.key)) {
      financeStep.fields.unshift(pf as unknown as Field);
      changes.push(`item 6: ${pf.key} field added`);
    }
  }
  for (const f of financeStep.fields) {
    const want = QUARTER_LABELS[f.key];
    if (want && !sameLabel(f.label, want)) {
      f.label = want;
      changes.push(`item 6: ${f.key} relabelled to the licensing period`);
    }
    if (f.key === "financial_year" && !sameLabel(f.label, FINANCIAL_YEAR_LABEL)) {
      f.label = FINANCIAL_YEAR_LABEL;
      changes.push("item 7: financial_year relabelled to the period's first-quarter year");
    }
  }

  // Item 4 — phone validation everywhere a phone is captured, in both journeys.
  for (const journey of def.journeys) {
    for (const step of journey.steps) {
      for (const f of step.fields) {
        if (!/(phone|contact_no)$/.test(f.key)) continue;
        const v = (f.validation ?? {}) as Record<string, unknown>;
        if (v.pattern !== UAE_PHONE) {
          f.validation = { ...v, pattern: UAE_PHONE, message: UAE_PHONE_MSG };
          changes.push(`item 4: ${journey.key}.${f.key} UAE phone pattern`);
        }
      }
    }
  }

  // Item 1 reverses yesterday's FB-1565 rule, but only for renewals. Leaving
  // both in the renewal prompt would be a direct contradiction ("never emit two
  // upload blocks" vs "emit one for each"), so the older bullet is dropped from
  // THIS journey only — new_license keeps its one-ask-at-a-time flow.
  const oneAsk = /^- ONE ASK PER MESSAGE:.*$/m;
  if (renewal.guidance && oneAsk.test(renewal.guidance)) {
    renewal.guidance = renewal.guidance.replace(oneAsk, "").replace(/\n{3,}/g, "\n\n");
    changes.push("item 1: dropped the conflicting ONE ASK PER MESSAGE rule from renewal only");
  }

  // Items 1/2/4/6/7/8 — the agent's half.
  const nextGuidance = withBlock(renewal.guidance ?? "");
  if (nextGuidance !== renewal.guidance) {
    renewal.guidance = nextGuidance;
    changes.push("items 1/2/4/6/7/8: renewal guidance rules");
  }

  // Item 6 — Salesforce rows need the real calendar quarter.
  const flow = renewal.submission?.apiFlow;
  if (flow && !String(flow.notes ?? "").includes(APIFLOW_MARKER)) {
    flow.notes = `${flow.notes ?? ""}${APIFLOW_NOTE}`;
    changes.push("item 6: quarter derivation added to the renewal apiFlow notes");
  }

  if (!changes.length) {
    console.log("No changes — already applied.");
    return;
  }
  await db.update(agents).set({ definition: def as never, updatedAt: new Date() }).where(eq(agents.id, row.id));
  console.log(`Updated ${SLUG} (${changes.length} changes):`);
  for (const c of changes) console.log(`  - ${c}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
