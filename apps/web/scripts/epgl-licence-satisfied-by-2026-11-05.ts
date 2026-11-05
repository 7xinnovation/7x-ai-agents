/**
 * One trade licence, asked for once (5 November 2026).
 *
 * EPGL's catalogue names the trade licence twice — "Trade Licence / Initial
 * Name Approval" for CEP30 and "Trade Licence" for the other four products —
 * and our own `trade_license` slot reads the company off the same file. On
 * 4 November an applicant was asked for it a second time, in the very reply
 * that confirmed the product: the twin that copies the file across is filled at
 * the start of a turn, and the product had arrived during it.
 *
 * So the two catalogue slots are declared `satisfiedBy: ["trade_license"]`.
 * Readiness counts them as in the moment the licence is, and the prompt tells
 * the model they are the same document. The twin still copies the file under
 * EPGL's name so it reaches their checklist.
 *
 * STAGING ONLY — agent config does not travel with a merge.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-licence-satisfied-by-2026-11-05.ts --env <stg env file>
 *   npx tsx scripts/epgl-licence-satisfied-by-2026-11-05.ts --env <stg env file> --revert
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { agents } from "@dialog/db";
import { databaseUrlFrom } from "./lib/envFile";
import { LICENCE_SATISFIED_BY } from "../lib/epglLicenceSlots";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const REVERT = process.argv.includes("--revert");
const SLUG = "epgl-dialog-2";

const SATISFIED_BY = LICENCE_SATISFIED_BY;

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found`);
    const def = JSON.parse(JSON.stringify(row.definition)) as any;
    if ((def.activeEnvironment ?? "staging") !== "staging") throw new Error(`refusing: ${SLUG} is not on staging`);
    let touched = 0;
    for (const j of def.journeys ?? []) for (const st of j.steps ?? []) for (const d of st.documents ?? []) {
      const want = SATISFIED_BY[d.key];
      if (!want) continue;
      const before = JSON.stringify(d.satisfiedBy ?? null);
      if (REVERT) { if (d.satisfiedBy === undefined) continue; delete d.satisfiedBy; }
      else { if (before === JSON.stringify(want)) continue; d.satisfiedBy = want; }
      touched++;
      console.log(`  ${j.key}/${d.key}: ${before}  ->  ${REVERT ? "null" : JSON.stringify(want)}`);
    }
    if (!touched) { console.log("nothing to change"); return; }
    await db.update(agents).set({ definition: def }).where(eq(agents.id, row.id));
    console.log(`\n${touched} slot(s) updated on ${SLUG} (staging).`);
  } finally {
    await pool.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
