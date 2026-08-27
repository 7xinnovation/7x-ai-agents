/**
 * Hold the box at the last possible moment (2026-08-27).
 *
 * The hold step added this morning is called as soon as the customer picks a box.
 * That is too early: nothing in the Emirates Post spec releases a hold — there is
 * no release, cancel, unhold or abandon endpoint for a rental, only
 * Renewal/ValidateCancel and Renewal/VerifyCancel, which are a different journey.
 * So a customer who picks a box and then closes the tab takes that box out of
 * circulation permanently, and a staging branch with a handful of numbers empties
 * in an afternoon of testing.
 *
 * Moving it to immediately before the charge: the customer has seen the summary
 * and confirmed, request_payment is the very next call. That still holds before
 * any money moves — which is the point, since Save cannot record a rental without
 * a hold — while shrinking the abandonment window from the whole rest of the
 * journey to a single turn.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-hold-timing-2026-08-27.ts [--env <file>]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const OLD = "As soon as the customer picks their box number, and BEFORE taking payment, call post_api_Rental_Select";
const NEW =
  "Call post_api_Rental_Select at the LAST moment before the charge — after the customer has confirmed the pre-payment summary, in the same turn as request_payment and immediately before it. NOT when they pick the box: a hold cannot be released (Emirates Post publishes no endpoint for it), so a customer who picks a box and leaves takes it out of circulation for good. Call it with";

interface Journey { key: string; submission?: { apiFlow?: { notes?: string; saveTool?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = 0;
  for (const j of def.journeys) {
    const flow = j.submission?.apiFlow;
    if (flow?.saveTool !== "post_api_Rental_Save") { console.log(`  (skip) ${j.key}`); continue; }
    const notes = String(flow.notes ?? "");
    if (!notes.includes(OLD)) { console.log(`  (skip) ${j.key} — already applied`); continue; }
    flow.notes = notes.replace(OLD, NEW);
    changed++;
    console.log(`  + ${j.key}`);
  }
  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
