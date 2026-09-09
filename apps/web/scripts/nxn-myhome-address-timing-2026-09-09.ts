/**
 * Take the MyHome delivery address BEFORE the price summary, not during the save.
 *
 * Reported 9 September: the customer saw the full breakdown — AED 1,390 rental,
 * AED 70 registration, AED 1,460 total — then "Now saving your order", and only
 * THEN "Before I can complete the order, I need your delivery address". Pin,
 * area confirmation, villa number and building name all came after the money had
 * been totalled, the save failed with 173, and it took a retry to get through.
 *
 * The existing rule says the address is not the next thing to ask when they pick
 * MyHome, which is right — the branch has to be resolved first or the save has no
 * deliveryOfficeID. But it never said WHEN, so the model deferred it to the last
 * possible moment: the save itself.
 *
 * There is a place for it, and it is before the summary. Nothing about a total
 * changes once the address is known, so asking there costs the customer nothing
 * and stops an order being created against an address nobody has given yet.
 *
 * Also stops backend error codes reaching the customer. "Error 173 means the
 * delivery area wasn't accepted" is us reading out Emirates Post's internal
 * numbering to somebody who cannot act on it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-myhome-address-timing-2026-09-09.ts --env <file> [--apply]
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

const MARKER = "WHEN THE MYHOME ADDRESS IS TAKEN (2026-09-09)";
const RULE =
  " " + MARKER + ": for MyHome and MyHome Instant, collect the delivery address AFTER the box and the duration are chosen and BEFORE you show the order summary." +
  " Not when they pick the bundle — the branch has to be resolved first. And never at save time: on 9 September a customer was shown a total of AED 1,460, told the order was being saved, and only then asked where they live. That is the worst possible moment for it. They then had to drop a pin, confirm an area, give a villa number and a building name while an order was half-created, and the save failed and had to be retried." +
  " The address changes nothing about the total, so asking before the summary costs the customer nothing and means the summary describes something complete." +
  " Take all of it in one go — area, street, building or villa name, villa or apartment number — then show the summary, then take payment.";

const NO_CODES =
  " BACKEND ERROR CODES ARE NOT FOR THE CUSTOMER: never write \"Error 173\", \"MYHOME_ADDDRESS_NOT_FOUND\", a response code or any other identifier from Emirates Post's API into the chat. They mean nothing to the person reading and there is nothing they can do with one. Say what it means for them and what happens next — \"that area did not come back as one we deliver to, let me try the exact area code\" — and keep the number to yourself.";

const JOURNEYS = ["personal_po_box_rental", "corporate_po_box_rental", "manage_po_box"];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog"));
    if (!row) throw new Error("nxn-dialog not found");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];
    for (const j of def.journeys ?? []) {
      if (!JOURNEYS.includes(j.key)) continue;
      if (String(j.guidance ?? "").includes(MARKER)) { console.log(`  (skip) ${j.key}`); continue; }
      j.guidance = String(j.guidance ?? "") + RULE + NO_CODES;
      changes.push(`${j.key}.guidance += address timing + no error codes`);
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
