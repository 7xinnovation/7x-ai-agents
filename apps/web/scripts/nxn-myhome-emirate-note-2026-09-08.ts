/**
 * Say where a MyHome box gets delivered BEFORE asking for the address.
 *
 * UAT, 8 September: a tester chose a MyHome box in Abu Dhabi, shared a Dubai
 * address, and was told "That pin is in Dubai, but your box is in Abu Dhabi. A
 * MyHome box is delivered to the same emirate it is registered in." They
 * reported it as the agent refusing them.
 *
 * The refusal is correct and the constraint is real: for MyHome the LocationId
 * IS the emirate code, so the box comes from that emirate's pool and is
 * delivered within it. Nor can the order be swapped -- the guidance already
 * explains, at length, why the delivery address cannot be asked for first: the
 * save needs the delivery office and without it Emirates Post refuses with
 * 173 MYHOME_ADDDRESS_NOT_FOUND, which then blames the address.
 *
 * So the fix is not to allow it and not to reorder it. It is to say so at the
 * moment the emirate is chosen, one line, so the customer knows before they go
 * and find a pin rather than after.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-myhome-emirate-note-2026-09-08.ts --env <file> [--apply]
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

const MARKER = "WHERE A MYHOME BOX IS DELIVERED (2026-09-08)";
const RULE =
  ` ${MARKER}: a MyHome or MyHome Instant box is delivered ONLY within the emirate it is registered in — for those bundles the emirate IS the box's location, not just where it was bought.` +
  ` So when the customer picks the emirate for one of these bundles, say in the same breath that their mail will be delivered to an address in that emirate, e.g. "Your MyHome box will be registered in Abu Dhabi, so we'll deliver to an Abu Dhabi address."` +
  ` One line, at that moment — not later, and not as a warning.` +
  ` A customer who is told after they have shared a location has been sent to find a pin that was never going to be accepted, which is what happened on 8 September.` +
  ` If their address does turn out to be in another emirate, do NOT treat it as their mistake or as an error: offer both ways out plainly — register the box in the emirate they actually live in, or give an address in the emirate they chose — and let them pick.` +
  ` The order of questions does not change: the emirate and branch still come before the address, because the save needs the delivery office and fails without it.`;

/** Journeys that can sell a MyHome bundle. */
const JOURNEYS = ["personal_po_box_rental", "corporate_po_box_rental", "manage_po_box"];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog"));
    if (!row) throw new Error("nxn-dialog not found in this database");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];
    for (const j of def.journeys ?? []) {
      if (!JOURNEYS.includes(j.key)) continue;
      if (String(j.guidance ?? "").includes(MARKER)) {
        console.log(`  (skip) ${j.key}: already carries the rule`);
        continue;
      }
      j.guidance = String(j.guidance ?? "") + RULE;
      changes.push(`${j.key}.guidance += MyHome emirate note`);
    }
    if (!changes.length) { console.log("nothing to do — already applied."); return; }
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
