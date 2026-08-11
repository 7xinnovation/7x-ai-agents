/**
 * Verifies the "Renewal AI Process Feedback" round (2026-08-11) is in effect —
 * the stored definition, the code that enforces it, and the phone pattern
 * actually run against real inputs.
 *
 * Run from apps/web:  npx tsx scripts/verify-epgl-renewal-feedback-2026-08-11.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(HERE, "../../../.env") });

import { readFileSync } from "node:fs";
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { DOC_TYPES, DOC_TYPE_LABELS } from "@dialog/core";

const src = (p: string) => readFileSync(resolve(HERE, "..", p), "utf8");
let pass = 0, fail = 0;
const check = (item: string, name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ [${item}] ${name}`); }
  else { fail++; console.log(`  ✗ [${item}] ${name}${detail ? ` — ${detail}` : ""}`); }
};

interface Field { key: string; label?: { en: string; ar: string }; validation?: { pattern?: string; message?: unknown } }
interface Step { key: string; fields: Field[]; documents?: { key: string; requirement: string }[] }
interface Journey { key: string; guidance?: string; steps: Step[]; submission?: any }
interface Definition { journeys: Journey[]; uploadsPerMessage?: number }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!row) throw new Error("epgl-dialog not found");
  const def = row.definition as unknown as Definition;
  const renewal = def.journeys.find((j) => j.key === "renewal")!;
  const g = renewal.guidance ?? "";
  const fields = renewal.steps.flatMap((s) => s.fields);
  const docs = renewal.steps.flatMap((s) => s.documents ?? []);
  const uploadSrc = src("app/api/upload/route.ts");

  console.log("\nItem 1 — batch document uploads");
  check("1", "no per-message upload cap", def.uploadsPerMessage === undefined,
    `uploadsPerMessage=${def.uploadsPerMessage}`);
  check("1", "guidance requires all documents in one message", /ALL DOCUMENTS AT ONCE/.test(g));
  check("1", "an upload block for each document, same message",
    /emit an ```upload block for EACH of them in that same message/.test(g));
  check("1", "mandatory vs optional made clear", /Mark clearly which are mandatory and which are optional/.test(g));

  console.log("\nItem 2 — validation and cross-checking");
  check("2", "Form 9 is its own document type", DOC_TYPES.includes("form_9" as never));
  check("2", "AFS and acknowledgement letter are typed too",
    DOC_TYPES.includes("audited_financial_statement" as never) && DOC_TYPES.includes("acknowledgement_letter" as never));
  check("2", "each new type has a customer-facing label",
    !!DOC_TYPE_LABELS["form_9" as never] && !!DOC_TYPE_LABELS["audited_financial_statement" as never]);
  const extractSrc = src("../../packages/core/src/ai/extract.ts");
  check("2", "the classifier is told how to tell them apart",
    /it does not license\s*\n?\s*anything|reports revenue, it does not license/.test(extractSrc) ||
    /is NOT a license of any kind/.test(extractSrc));
  check("2", "a Form 9 slot cannot fall through to a licence slot",
    /form\.\?0\?9\|نموذج\.\?9/.test(uploadSrc.replace(/\\\\/g, "\\")) || /form\.?\?0\?9/.test(uploadSrc));
  check("2", "uploads are cross-checked against the entity on file",
    /function entityMismatch/.test(uploadSrc) && /document_rejected_entity_mismatch/.test(uploadSrc));
  check("2", "cross-check compares licence number and company name",
    /trade_license_number/.test(uploadSrc) && /company_name/.test(uploadSrc) && /postal_license_number/.test(uploadSrc));
  check("2", "agent must not talk past a rejection",
    /A REJECTED DOCUMENT IS NOT RECEIVED/.test(g) && /never confirm receipt or move on/.test(g));

  console.log("\nItem 4 — UAE phone formatting");
  const phoneFields = def.journeys.flatMap((j) => j.steps.flatMap((s) => s.fields))
    .filter((f) => /(phone|contact_no)$/.test(f.key));
  check("4", "every phone field carries a pattern", phoneFields.length > 0 && phoneFields.every((f) => !!f.validation?.pattern),
    phoneFields.filter((f) => !f.validation?.pattern).map((f) => f.key).join(", "));
  check("4", "a corrective message is supplied", phoneFields.every((f) => !!f.validation?.message));
  const pattern = phoneFields[0]?.validation?.pattern ?? "";
  const re = new RegExp(pattern);
  const valid = ["0501234567", "+971501234567", "050 123 4567", "+971 4 123 4567", "042345678", "00971521234567"];
  const invalid = ["12345", "0511234567", "+441234567890", "05012345678", "abcdefghij", "+9715012345"];
  check("4", "accepts real UAE numbers", valid.every((v) => re.test(v)),
    valid.filter((v) => !re.test(v)).join(", "));
  check("4", "rejects malformed and foreign numbers", invalid.every((v) => !re.test(v)),
    invalid.filter((v) => re.test(v)).join(", "));
  check("4", "guidance refuses to reformat a foreign number",
    /do\s*\n?\s*not record it and do not reformat a foreign number/.test(g) || /do not reformat a foreign number/.test(g));

  console.log("\nItems 6 + 7 — quarters follow the licence period");
  check("6", "the period's start quarter is captured",
    fields.some((f) => f.key === "license_period_start_quarter"));
  check("6", "income fields name the period, not the calendar",
    ["leviable_income_q1", "leviable_income_q2", "leviable_income_q3", "leviable_income_q4"]
      .every((k) => /quarter of the licensing period/i.test(fields.find((f) => f.key === k)?.label?.en ?? "")));
  check("6", "guidance forbids assuming calendar Q1",
    /NEVER assume the first quarter is Q1 of a calendar year/.test(g));
  check("6", "quarters are named with their calendar label and year",
    /name it in full with its calendar label and year/.test(g));
  check("6", "a customer saying \"my Q1 is Q3 2023\" is understood",
    /if they tell you\s*\n?\s*their first quarter is Q3 2023, take that as the period start/.test(g) ||
    /take that as the period start and derive the rest/.test(g));
  check("7", "financial year is the first quarter's year",
    /the year the licensing period's first quarter/i.test(fields.find((f) => f.key === "financial_year")?.label?.en ?? ""));
  check("7", "guidance states the same rule",
    /record financial_year as the YEAR THAT FIRST QUARTER/.test(g));
  check("6", "Salesforce rows get the real calendar quarter",
    /QUARTER DERIVATION \(2026-08-11\)/.test(String(renewal.submission?.apiFlow?.notes ?? "")));
  check("6", "the derivation is spelled out with an example",
    /q3 = Q1\/2024, q4 = Q2\/2024/i.test(String(renewal.submission?.apiFlow?.notes ?? "")));
  check("6", "figures are read off the Form 9, not dictated",
    /READ THE FIGURES, DO NOT DICTATE THEM/.test(g) && /present all four together in one/.test(g));
  check("6", "the customer gets a confirm-or-edit choice",
    /are these correct, or does\s*\n?\s*anything need changing/.test(g) || /confirm \/ change a figure/.test(g));

  console.log("\nItem 8 — revenue documents");
  const byKey = Object.fromEntries(docs.map((d) => [d.key, d.requirement]));
  check("8", "Form 9 is collected and mandatory", byKey["form_9"] === "mandatory", `got ${byKey["form_9"]}`);
  check("8", "AFS is collected and mandatory",
    byKey["audited_financial_statement"] === "mandatory", `got ${byKey["audited_financial_statement"]}`);
  check("8", "the acknowledgement letter is accepted", !!byKey["acknowledgement_letter"]);
  check("8", "guidance explains why they are needed",
    /confirm the audit is\s*\n?\s*complete rather than leaving the request partially closed/.test(g) ||
    /partially closed/.test(g));
  check("8", "the Form 09 guardrail does not block handling the document",
    /guardrail on Form 09 is about not advising/.test(g));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

export {};
