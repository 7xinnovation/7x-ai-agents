/**
 * A two-option choice, stacked (FB-1795).
 *
 * "Give the opposite option correct placement, right after the rent request.
 * Show both messages as one." Side by side, a confirmation and its alternative
 * read as two objects floating under a sentence; stacked and full width they
 * read in the order they are meant to, with the alternative directly beneath
 * the thing it is an alternative to.
 *
 * A setting rather than a deploy because the chat renderer is shared, and one
 * tenant's feedback is not a reason to change another tenant's screens.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-stacked-choices-2026-09-29.ts --env <file> [--off] [--dry-run]
 */
import { databaseUrlFrom } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const WANT = !process.argv.includes("--off");
const DRY = process.argv.includes("--dry-run");
const SLUG = "nxn-dialog";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`No agent ${SLUG} in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    if (def.stackedChoices === WANT) {
      console.log(`Already applied — stackedChoices is ${WANT}`);
      return;
    }
    console.log(`  stackedChoices: ${JSON.stringify(def.stackedChoices ?? null)} -> ${WANT}`);
    def.stackedChoices = WANT;
    if (DRY) { console.log("\n--dry-run: not written."); return; }
    await db.update(agents).set({ definition: def as any }).where(eq(agents.id, row.id));
    console.log("\nWritten.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
