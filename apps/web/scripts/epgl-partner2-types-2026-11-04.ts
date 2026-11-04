/**
 * Does EPGL's checklist hold TWO partners' passports, or only one? (4 Nov 2026)
 *
 * Since 29 October partners 2–8 have carried no `salesforceType`, so their
 * documents are never sent. The reason written down at the time: their
 * catalogue has one `Copy of Passport` for the whole application and
 * `Document_Type` is the deduplication key, so partner 2's would stand where
 * partner 1's was and the application would arrive holding one passport.
 *
 * That was reasoning by analogy with 1.x, never a measurement. Checked on
 * 4 November: of every 2.0 composite that ever carried more than one document,
 * not one was two `Copy of Passport` items, and all of them failed for other
 * reasons. What WAS tested is that an invented per-partner name is refused
 * ("Document_Type \"Partner 1 - Emirates ID\" is not required for this
 * application") — a different claim entirely.
 *
 * So this gives partner 2 the catalogue's own names, so one application can be
 * filed with two passports and two Emirates IDs and their own status push can
 * answer the question. `--revert` puts it back.
 *
 * STAGING ONLY, and it refuses anything else: it is a deliberate experiment
 * against the NewLaw sandbox, not a configuration decision.
 *
 * Run from apps/web:
 *   npx tsx scripts/epgl-partner2-types-2026-11-04.ts --env <stg env file>
 *   npx tsx scripts/epgl-partner2-types-2026-11-04.ts --env <stg env file> --revert
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { agents } from "@dialog/db";
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const REVERT = process.argv.includes("--revert");
const SLUG = "epgl-dialog-2";

/** EPGL's own names, which is the whole point — an invented one is refused. */
export const UNDER_TEST: Record<string, string> = {
  partner_2_passport: "Copy of Passport",
  partner_2_emirates_id: "Copy of Emirates ID",
};

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found`);
    const def = JSON.parse(JSON.stringify(row.definition)) as any;
    if ((def.activeEnvironment ?? "staging") !== "staging") {
      throw new Error(`refusing: ${SLUG} is on "${def.activeEnvironment}", and this is a staging experiment`);
    }

    let touched = 0;
    for (const j of def.journeys ?? []) {
      for (const st of j.steps ?? []) {
        for (const doc of st.documents ?? []) {
          const want = UNDER_TEST[doc.key];
          if (!want) continue;
          const before = doc.salesforceType;
          if (REVERT) {
            if (before === undefined) continue;
            delete doc.salesforceType;
          } else {
            if (before === want) continue;
            doc.salesforceType = want;
          }
          touched++;
          console.log(`  ${doc.key.padEnd(24)} ${String(before ?? "—")}  ->  ${REVERT ? "—" : want}`);
        }
      }
    }
    if (!touched) { console.log("nothing to change — already in the state you asked for"); return; }
    await db.update(agents).set({ definition: def }).where(eq(agents.id, row.id));
    console.log(`\n${touched} slot(s) updated on ${SLUG} (staging).`);
    console.log(REVERT ? "Partner 2 is unsent again." : "File ONE application now, then read its status push for the document list.");
  } finally {
    await pool.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
