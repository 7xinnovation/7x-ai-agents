/**
 * The licence fee, set per environment.
 *
 * AED 150,000 flat is the real figure (the 1% "Admin processing fees" was
 * withdrawn on 3 September). Staging cannot charge it: the N-Genius SANDBOX
 * outlet refuses anything over AED 100,000 --
 *
 *   AED  99,655  ->  201 order created
 *   AED  99,946  ->  422 amountLimitExceeded
 *   AED 150,000  ->  422 "Amount limit exceeded for currency AED"
 *
 * -- measured against outlet b78ef8c7 on 10 September. So staging stays at a
 * payable amount and the card branch remains testable end to end, and the real
 * fee belongs to production, whose merchant has no such risk rule.
 *
 * The amount is never the model's to choose (the NXN AED 450-vs-400 bug is the
 * precedent); it is read from the journey and charged server-side. This is the
 * only place it is set.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-licence-fee-2026-09-10.ts --env <file> [--amount 150000] [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");
const AMOUNT = Number(arg("--amount") ?? 150000);
if (!ENV) throw new Error("--env <envfile> is required");
if (!Number.isFinite(AMOUNT) || AMOUNT <= 0) throw new Error("--amount must be a positive number of dirhams");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
/** What the sandbox gateway will actually take. Above this the card 422s. */
const SANDBOX_CEILING = 100_000;

async function main() {
  const url = databaseUrlFrom(ENV!);
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];

    for (const j of def.journeys ?? []) {
      if (!j?.submission) continue;
      const was = j.submission.amount;
      if (was === AMOUNT) continue;
      j.submission.amount = AMOUNT;
      changes.push(`${j.key}: submission.amount ${was} -> ${AMOUNT}`);
    }

    const gateway = String(def?.integrations?.payment?.settings?.baseUrl ?? "");
    if (/sandbox/i.test(gateway) && AMOUNT > SANDBOX_CEILING) {
      console.log(
        `\nWARNING: this environment's gateway is the N-Genius SANDBOX and it refuses\n` +
          `anything over about AED ${SANDBOX_CEILING.toLocaleString()}. At AED ${AMOUNT.toLocaleString()} the payment card will\n` +
          `fail with 422 amountLimitExceeded and no card test can be completed here.\n`
      );
    }

    if (!changes.length) { console.log(`nothing to do — already AED ${AMOUNT.toLocaleString()}.`); return; }
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else console.log("\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
