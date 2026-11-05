/**
 * Partners 2-8's passports and Emirates IDs go to EPGL, each under its holder
 * (5 November 2026).
 *
 * Until now partners 2-8 carried no `salesforceType` and were never sent: an
 * application had one "Copy of Passport" slot, and partner 2's arrived as an
 * extra file behind partner 1's (the 4 November experiment, since reverted).
 * EPGL added an optional `Holder` on document items that gives each further
 * partner a slot of their own. The code now sends it (lib/epglComposite,
 * holderOf); this gives the slots the catalogue names it needs.
 *
 * STAGING ONLY, and it refuses anything else. `--revert` takes the names off.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-partner-holder-2026-11-05.ts --env <stg env file>
 *   npx tsx scripts/epgl-partner-holder-2026-11-05.ts --env <stg env file> --revert
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { agents } from "@dialog/db";
import { databaseUrlFrom } from "./lib/envFile";
import { PARTNER_SALESFORCE_TYPES } from "@/lib/epglPartnerSlots";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const REVERT = process.argv.includes("--revert");
const SLUG = "epgl-dialog-2";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found`);
    const def = JSON.parse(JSON.stringify(row.definition)) as any;
    if ((def.activeEnvironment ?? "staging") !== "staging") {
      throw new Error(`refusing: ${SLUG} is on "${def.activeEnvironment}"`);
    }
    let touched = 0;
    for (const j of def.journeys ?? []) {
      // new_license only: renewal files no documents through the composite.
      if (j.key !== "new_license") continue;
      for (const st of j.steps ?? []) for (const doc of st.documents ?? []) {
        const want = PARTNER_SALESFORCE_TYPES[doc.key];
        if (!want) continue;
        const before = doc.salesforceType;
        if (REVERT) { if (before === undefined) continue; delete doc.salesforceType; }
        else { if (before === want) continue; doc.salesforceType = want; }
        touched++;
        console.log(`  ${doc.key.padEnd(24)} ${String(before ?? "—")}  ->  ${REVERT ? "—" : want}`);
      }
    }
    if (!touched) { console.log("nothing to change — already in the state you asked for"); return; }
    await db.update(agents).set({ definition: def }).where(eq(agents.id, row.id));
    console.log(`\n${touched} slot(s) updated on ${SLUG} (staging).`);
  } finally {
    await pool.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
