/**
 * A/B the intent classifier across models, on accuracy AND latency.
 *
 * The classifier is the one side task worth moving to a small model: it picks a
 * single label from a fixed list through a forced tool call, and it runs
 * concurrently with the customer's own turn. But "faster" is only worth having
 * if it is not "wronger" — a misclassification sends someone into the wrong
 * journey — so this measures both before anything is switched.
 *
 * Cases include the deliberately awkward ones (bilingual, oblique phrasing,
 * corporate-vs-personal, renew-vs-rent), because that is where a smaller model
 * is expected to slip if it is going to.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/ab-intent-model.ts [model-a] [model-b]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { readFileSync } from "node:fs";
import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { AgentDefinition, type Locale } from "@dialog/config";
import { classifyIntent } from "@dialog/core";

const MODEL_A = process.argv[2] ?? "claude-sonnet-4-6";
const MODEL_B = process.argv[3] ?? "claude-haiku-4-5";

interface Case { message: string; locale: Locale; expected: string }

/** NXN has no eval set; these cover all nine intents in both languages. */
const NXN_CASES: Case[] = [
  { message: "I want to rent a new PO Box for myself", locale: "en", expected: "new_personal_pobox" },
  { message: "أريد استئجار صندوق بريد شخصي جديد", locale: "ar", expected: "new_personal_pobox" },
  { message: "My PO Box expires next month, what do I do?", locale: "en", expected: "renew_personal_pobox" },
  { message: "أريد تجديد صندوق البريد الخاص بي", locale: "ar", expected: "renew_personal_pobox" },
  { message: "We need a PO Box for our company", locale: "en", expected: "new_corporate_pobox" },
  { message: "Renew the mailbox registered to our trade licence", locale: "en", expected: "renew_corporate_pobox" },
  { message: "I need to add an authorised agent to my box", locale: "en", expected: "manage_pobox" },
  { message: "Where is my parcel? The number is EP123456789AE", locale: "en", expected: "shipment_tracking" },
  { message: "أين شحنتي؟", locale: "ar", expected: "shipment_tracking" },
  { message: "How much does a MyHome box cost per year?", locale: "en", expected: "service_info" },
  { message: "ما هي أنواع الباقات المتوفرة؟", locale: "ar", expected: "service_info" },
  { message: "Can someone call me back please", locale: "en", expected: "human_help" },
  { message: "What happened to the request I submitted last week?", locale: "en", expected: "status_inquiry" },
  // Deliberately awkward: renewal phrased without the word "renew".
  { message: "My box 33417 runs out in February and I want to keep it", locale: "en", expected: "renew_personal_pobox" },
  // Corporate signalled only by "our company's licence".
  { message: "Our company's licence is ready, we want a mailbox at Al Barsha", locale: "en", expected: "new_corporate_pobox" },
];

function loadEpglCases(): Case[] {
  try {
    const raw = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/eval/datasets/epgl.json"), "utf8"));
    return (raw.intentCases ?? []).map((c: { message: string; locale?: string; expected: string }) => ({
      message: c.message, locale: (c.locale ?? "en") as Locale, expected: c.expected,
    }));
  } catch { return []; }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2)) : 0;
};

async function runSet(def: AgentDefinition, cases: Case[], model: string) {
  const prev = process.env.DIALOG_FAST_MODEL;
  process.env.DIALOG_FAST_MODEL = model;
  const times: number[] = [];
  const misses: string[] = [];
  let correct = 0;
  for (const c of cases) {
    const t0 = Date.now();
    let got = "unknown";
    try { got = (await classifyIntent(def, c.message, c.locale)).intent; } catch { got = "ERROR"; }
    times.push(Date.now() - t0);
    if (got === c.expected) correct++;
    else misses.push(`      "${c.message.slice(0, 46)}" → ${got} (expected ${c.expected})`);
  }
  process.env.DIALOG_FAST_MODEL = prev;
  return { correct, total: cases.length, med: median(times), misses };
}

async function main() {
  const db = getDb();
  console.log(`A: ${MODEL_A}\nB: ${MODEL_B}\n`);
  for (const [slug, extra] of [["nxn-dialog", NXN_CASES], ["epgl-dialog", loadEpglCases()]] as [string, Case[]][]) {
    if (!extra.length) continue;
    const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
    if (!row) continue;
    const def = AgentDefinition.parse(row.definition);
    console.log(`── ${slug} (${extra.length} cases, ${def.intents.length} intents) ──`);
    for (const model of [MODEL_A, MODEL_B]) {
      const r = await runSet(def, extra, model);
      const pct = ((r.correct / r.total) * 100).toFixed(0);
      console.log(`  ${model.padEnd(20)} accuracy ${String(r.correct).padStart(2)}/${r.total} (${pct}%)   median ${String(r.med).padStart(5)}ms`);
      r.misses.forEach((m) => console.log(m));
    }
    console.log();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
