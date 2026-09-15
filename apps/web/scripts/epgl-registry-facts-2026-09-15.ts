/**
 * The registry answers two of the questions we were still asking.
 *
 * `epgl_licences_for_customer` has always parsed the licensed ACTIVITIES and the
 * PEOPLE on each licence and then summarised them out of the tool's result — so
 * a signed-in applicant was asked which postal services their company provides
 * while MOEc's own list sat in the response we had just read (FB-1723), and
 * asked whether a partner lives in the UAE while `isManagerResidentofUAE` sat
 * beside their name.
 *
 * Both now reach the model. This is the half of it that lives in the guidance:
 * the rules that say to READ the licence for activities and to ASK about
 * residence were written before the registry returned either, and name only the
 * uploaded document.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-registry-facts-2026-09-15.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");
if (!ENV) throw new Error("--env <envfile> is required");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const RULE =
  "THE REGISTRY HAS ALREADY ANSWERED SOME OF THIS (2026-09-15): for a SIGNED-IN customer, epgl_licences_for_customer returns the Ministry of Economy's own record of each licence, and two things in it replace questions you would otherwise ask. " +
  "ACTIVITIES: each licence carries `activities` — MOEc's code and the name in English and Arabic. When the licence they chose lists them, that IS the answer to which services the company is licensed for; map the postal ones onto Letters & Post Items Delivery, Documents Delivery and Parcels Delivery, record them, and do not put the question to a customer whose own registry entry you are looking at. " +
  "PEOPLE: `people` is who the registry names on that licence — names in both scripts, Emirates ID, nationality, passport, share, and `isUaeResident`. Pre-fill the partners from it and ask only for confirmation. `isUaeResident: false` is the REGISTRY saying that person does not live here, which is evidence rather than a guess from a passport: record them as Non Resident and do not ask for an Emirates ID they cannot have. `isUaeResident: true` means they do have one, so ask for it as normal. " +
  "WHAT THIS DOES NOT CHANGE: it only ever appears for a licence the registry names this customer on, and only for a signed-in customer — everybody else is asked exactly as before. A partner the registry does not name is collected from the customer as usual. An identity number from the registry is confirmed by its last four characters and never read back in full, like any other. And the registry is a record, not the customer: if they say it is out of date, they are right and their answer wins. ";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  const changes: string[] = [];
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!row) throw new Error("epgl-dialog not found in this database");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    for (const j of def.journeys ?? []) {
      const g = String(j.guidance ?? "");
      if (g.includes(RULE.trim())) continue;
      j.guidance = `${g.trimEnd()}\n\n${RULE.trim()}`;
      changes.push(String(j.key));
    }
    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} journey(s): ${changes.join(", ")}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("written.");
    } else console.log("Dry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
