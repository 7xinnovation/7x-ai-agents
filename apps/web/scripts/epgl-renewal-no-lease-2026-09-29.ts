/**
 * A renewal does not ask for the Ejari (2026-09-29).
 *
 * "Remove this Ejari or lease contract to not be asked" — it was appearing in
 * the renewal's "here's what you'll need to have ready" list, as the only
 * optional item on it, directly under four mandatory partner documents.
 *
 * It belongs on a NEW licence and stays there. That slot was added on
 * 11 September for a stated reason, which is still in that journey's guidance:
 * "EPGL check the licensed premises, so the company's lease contract (Ejari or
 * the emirate's equivalent) now has a slot." The renewal got the same slot from
 * the same script and never got the reason — there is no rule about it in the
 * renewal's guidance at all, because nothing in a renewal turns on it.
 *
 * Optional, so nothing was blocked by it; it was noise on a list where every
 * other line is something the customer has to go and find.
 *
 * Idempotent, and the renewal only. Run from apps/web:
 *   npx tsx scripts/epgl-renewal-no-lease-2026-09-29.ts --env <file> [--dry-run]
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
const DRY = process.argv.includes("--dry-run");

const JOURNEY = "renewal";
const DOC_KEY = "lease_contract";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!row) throw new Error("epgl-dialog not found in this database");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    let changes = 0;

    const journey = (def.journeys ?? []).find((j: any) => j.key === JOURNEY);
    if (!journey) throw new Error(`no ${JOURNEY} journey here`);

    for (const step of journey.steps ?? []) {
      const before = (step.documents ?? []).length;
      const doc = (step.documents ?? []).find((d: any) => d.key === DOC_KEY);
      if (!doc) continue;
      /**
       * REFUSE TO REMOVE SOMETHING MANDATORY. If EPGL ever make the lease a
       * requirement of a renewal, this script must stop rather than quietly
       * delete a document the submission needs.
       */
      if (doc.requirement === "mandatory") {
        throw new Error(`${JOURNEY}.${step.key}: ${DOC_KEY} is MANDATORY here — that is a decision, not leftovers. Resolve it before removing.`);
      }
      step.documents = (step.documents ?? []).filter((d: any) => d.key !== DOC_KEY);
      console.log(`  - ${JOURNEY}.${step.key}: removed ${DOC_KEY} (${before} -> ${step.documents.length} documents)`);
      changes++;
    }

    // And the new licence keeps it, which is the whole point of doing this per
    // journey. Said out loud so a later reader does not "tidy up" the other one.
    const nl = (def.journeys ?? []).find((j: any) => j.key === "new_license");
    const nlHas = (nl?.steps ?? []).some((s: any) => (s.documents ?? []).some((d: any) => d.key === DOC_KEY));
    console.log(`  (left alone) new_license still ${nlHas ? "HAS" : "does NOT have"} ${DOC_KEY}`);

    if (!changes) { console.log("\nAlready applied — nothing to change."); return; }
    if (DRY) { console.log(`\n--dry-run: ${changes} change(s) NOT written.`); return; }
    await db.update(agents).set({ definition: def as any }).where(eq(agents.id, row.id));
    console.log(`\n${changes} change(s) written.`);
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
