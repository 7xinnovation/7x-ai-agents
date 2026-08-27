/**
 * The real Rental/Select -> Save contract, proved against staging (2026-08-27).
 *
 * Every "box is not available" was us sending the wrong identifier. Verified with
 * a live customer session at Naif Post Office (LocationId 214, BundleId IN):
 *
 *   FreeBoxes returns pairs: {"uniqueBoxId":"2378781","boxId":"378781"}
 *   Select with uniqueBoxID "378781"  -> 400 BOX_NOT_FREE   (what we were sending)
 *   Select with uniqueBoxID "2378781" -> 200 OK
 *
 * boxId is the number the customer knows. uniqueBoxId is the record key, and it
 * is what Select wants. Sending the friendly number gets BOX_NOT_FREE, which
 * reads as "someone took it" and is why four boxes in a row appeared to vanish.
 *
 * The 200 answers the rest of it too:
 *   subscriptionReferenceNumber: "260611681"   <- the field Save wants; not ours
 *   subcsriptionReferenceNumberExpiryDate      <- about an hour out, so holds DO
 *                                                 expire on their own
 *   minimumAmount: 370.0, from priceDetails:
 *       Annual P.O.Box Rental 300 + Registration fees 70   (mandatory)
 *       Key Delivery 30, Authorised Agents 50              (optional)
 *
 * We have been charging 300 — the bundle card price — and are 70 short of the
 * amount Emirates Post actually expects. Even a Save that got past the hold would
 * have been underpaid.
 *
 * Also: poBoxExpiryDate must be a string copied EXACTLY from Rental/ExpiryDates,
 * offset included ("2027-08-26T00:00:00+00:00"). Recomputing it, or dropping the
 * offset, returns "Invalid date value" — which reads like a backend fault and is
 * a formatting error.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-rental-chain-2026-08-27.ts [--env <file>]
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
const MARKER = "THE RENTAL CHAIN, VERIFIED (2026-08-27):";

const NOTE = [
  `${MARKER} Four calls, in this order. Each one feeds the next; skipping or improvising any of them is what produced "box not available" and a payment against no reservation.`,
  "1. FreeBoxes returns PAIRS per box: boxId (e.g. 378781) and uniqueBoxId (e.g. 2378781). SHOW the customer boxId — that is their box number. KEEP the matching uniqueBoxId. They are not interchangeable.",
  "2. ExpiryDates gives the permitted expiry dates as exact strings, e.g. \"2027-08-26T00:00:00+00:00\". Copy one VERBATIM, offset and all. Never compute a date, never trim the offset, never substitute today's day-of-month — anything else returns \"Invalid date value\", which looks like a backend fault and is not one.",
  "3. Select (post_api_Rental_Select) takes uniqueBoxID = the uniqueBoxId from step 1 (the 2-prefixed one, NOT the box number you showed), bundleId, and poBoxExpiryDate copied from step 2. Sending the box number instead returns BOX_NOT_FREE (108) — the box is fine, the identifier is wrong. Do NOT tell the customer a box was taken on the strength of a 108 until you are certain you sent uniqueBoxId.",
  "4. Select's response carries what everything after it needs: subscriptionReferenceNumber (Save wants exactly this — never your own payment reference), minimumAmount (the REAL total), and subcsriptionReferenceNumberExpiryDate (the hold lapses, roughly an hour, so do not linger between here and payment).",
  "PRICE: charge minimumAmount from Select, NOT the price on the bundle card. The card shows the annual rental alone; minimumAmount adds the mandatory registration fee (300 + 70 = 370 for MyBox). Quote the breakdown from priceDetails in the summary so the customer sees what the extra is. Charging the card price undercharges Emirates Post and the rental will not balance.",
  "Then Save with subscriptionReferenceNumber from Select and totalAmount exactly as charged.",
].join("\n");

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
    if (notes.includes(MARKER)) { console.log(`  (skip) ${j.key} — already applied`); continue; }
    flow.notes = `${notes.trimEnd()}\n\n${NOTE}`;
    changed++;
    console.log(`  + ${j.key}`);
  }
  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
