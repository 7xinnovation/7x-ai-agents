/**
 * Offer the card they already have (2026-09-02).
 *
 * The journey said "At payment: if a saved card is on file, use it directly" and
 * nothing behind that sentence did anything — there was no lookup and no card on
 * the payload, so a signed-in customer with a card on file was sent to the
 * payment page to type it in again.
 *
 * The card is now read from Emirates Post and sent on the save, which is what
 * their own rent flow does. It pre-selects the card on the payment page; it does
 * not charge anything, and the customer can still change it there. This replaces
 * the sentence that promised more than it delivered.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-saved-card-2026-09-02.ts [--env <file>]
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
const JOURNEYS = ["personal_po_box_rental", "corporate_po_box_rental"];
const OLD = "At payment: if a saved card is on file, use it directly; otherwise capture the card via the payment gateway. ";
const NEW =
  "At payment: call nxn_saved_cards first. If Emirates Post already holds a card for them, say which one (\"your Visa ending 1111\") and that the payment page will open on it and they can change it there — the card is sent with the order for you, so do not ask for card details and never say they have been charged. If they have no card on file, just send them to the payment page. ";
const MARKER = "call nxn_saved_cards first";

interface Journey { key: string; guidance?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;
  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key) || typeof j.guidance !== "string") continue;
    if (j.guidance.includes(MARKER)) { console.log(`  (skip) ${j.key}`); continue; }
    if (!j.guidance.includes(OLD)) { console.log(`  ! ${j.key}: payment sentence not found — check by hand`); continue; }
    j.guidance = j.guidance.split(OLD).join(NEW);
    changed++;
    console.log(`  + ${j.key}: saved card offered properly`);
  }
  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
