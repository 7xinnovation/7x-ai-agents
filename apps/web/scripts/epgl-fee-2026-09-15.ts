/**
 * The licence fee is AED 100,700.
 *
 * It has been three different numbers in three places. Measured today:
 *
 *   production  charges 150,000, tells the customer 100,000
 *   staging     charges 1,000,   tells the customer 150,000
 *
 * Neither environment states what it charges, and neither states the right
 * figure. Emirates Post confirmed 100,700 on 15 September.
 *
 * TWO SEPARATE THINGS, and only one of them varies by environment. What we SAY
 * is a fact about the service and is corrected everywhere. What we CHARGE is
 * configuration: production takes the real fee, and staging cannot — N-Genius's
 * sandbox outlet refuses anything over about AED 100,000 (99,655 accepted,
 * 99,946 gives 422 amountLimitExceeded, measured), so 100,700 is above its
 * ceiling and staging stays at 1,000 deliberately.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-fee-2026-09-15.ts --env <file> [--amount 100700] [--apply]
 *
 * Omit --amount to correct only what the customer is told.
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const AMOUNT = arg("--amount") ? Number(arg("--amount")) : null;
const APPLY = process.argv.includes("--apply");
if (!ENV) throw new Error("--env <envfile> is required");
if (AMOUNT !== null && (!Number.isFinite(AMOUNT) || AMOUNT <= 0)) throw new Error("--amount must be a positive number");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents, kbChunks } from "@dialog/db";
import { eq } from "drizzle-orm";

/** Every way the old figures are written, in both languages. */
const SAY: [RegExp, string][] = [
  [/AED\s*1(?:00|50),000\b/g, "AED 100,700"],
  [/\b1(?:00|50),000\s*درهم/g, "100,700 درهم"],
];

const restate = (text: string) => SAY.reduce((t, [from, to]) => t.replace(from, to), text);

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents, kbChunks } });
  const changes: string[] = [];
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!row) throw new Error("epgl-dialog not found in this database");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;

    for (const j of def.journeys ?? []) {
      const before = String(j.guidance ?? "");
      const after = restate(before);
      if (after !== before) { j.guidance = after; changes.push(`${j.key}: the stated fee`); }
      if (AMOUNT !== null && j.submission && j.submission.amount !== AMOUNT) {
        changes.push(`${j.key}: submission.amount ${j.submission.amount} -> ${AMOUNT}`);
        j.submission.amount = AMOUNT;
      }
    }
    if (changes.length && APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
    }

    for (const c of await db.select().from(kbChunks).where(eq(kbChunks.agentId, row.id))) {
      const after = restate(c.content);
      if (after === c.content) continue;
      changes.push(`kb ${c.id.slice(0, 8)}: the stated fee`);
      if (APPLY) await db.update(kbChunks).set({ content: after }).where(eq(kbChunks.id, c.id));
    }

    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    console.log(APPLY ? "\nwritten." : "\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
