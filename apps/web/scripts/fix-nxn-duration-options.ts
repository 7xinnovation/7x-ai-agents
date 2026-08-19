/**
 * Let a customer record the durations Emirates Post actually offers (2026-08-19).
 *
 * The duration and renewal_period fields accept 1_YEAR and 2_YEAR only.
 * Rental/ExpiryDates returns FIVE options — verified for both a corporate and a
 * personal bundle:
 *
 *   2027-08-18, 2028-08-18, 2029-08-18, 2031-08-18, 2036-08-18
 *   = 1, 2, 3, 5 and 10 years
 *
 * And the renewal cards a customer was shown offered 1, 2, 5, 10 and 20 years.
 * So the agent presents durations it then cannot record: pick 5 years and the
 * field either stays empty or gets forced into a value that means something
 * else. Nothing errors — the case just carries the wrong term, and the readiness
 * panel looks satisfied.
 *
 * Found by auditing for static values that mirror backend data, after the same
 * shape caused three separate faults this week.
 *
 * The options are widened to what the API offers. They stay an enum because the
 * panel and readiness tracking need a closed set; the authoritative dates still
 * come from ExpiryDates, and the guidance already says so.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-duration-options.ts [--env <file>]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const KEYS = new Set(["duration", "renewal_period"]);

const OPTIONS = [
  { value: "1_YEAR", en: "1 year", ar: "سنة واحدة" },
  { value: "2_YEAR", en: "2 years", ar: "سنتان" },
  { value: "3_YEAR", en: "3 years", ar: "3 سنوات" },
  { value: "5_YEAR", en: "5 years", ar: "5 سنوات" },
  { value: "10_YEAR", en: "10 years", ar: "10 سنوات" },
  { value: "20_YEAR", en: "20 years", ar: "20 سنة" },
];

interface Field { key: string; options?: Array<{ value: string; label: { en: string; ar?: string } }>; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Array<{ key: string; steps: Array<{ fields: Field[] }> }> };

  const target = OPTIONS.map((o) => o.value).join(",");
  let changed = 0;
  for (const j of def.journeys) {
    for (const st of j.steps ?? []) {
      for (const f of st.fields ?? []) {
        if (!KEYS.has(f.key)) continue;
        const current = (f.options ?? []).map((o) => o.value).join(",");
        if (current === target) { console.log(`  (skip) ${j.key}.${f.key}`); continue; }
        console.log(`  + ${j.key}.${f.key}: [${current}] -> [${target}]`);
        f.options = OPTIONS.map((o) => ({ value: o.value, label: { en: o.en, ar: o.ar } }));
        changed++;
      }
    }
  }
  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} field(s) widened.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
