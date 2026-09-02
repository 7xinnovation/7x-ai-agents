/**
 * A guest has no account to save a card to (2026-09-02).
 *
 * The renewal journeys run without sign-in and still offered "Save my card for
 * future payments" and "Enable auto-renewal". Neither means anything for a guest:
 * Emirates Post has no account to hold the card against, and auto-renewal charges
 * a saved card that will not exist. The fields are gone; this removes the
 * instruction that renders the switches, which is what the customer sees.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-guest-no-account-toggles-2026-09-02.ts [--env <file>]
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
const JOURNEYS = ["personal_po_box_renewal", "corporate_po_box_renewal"];

const OLD =
  "Before charging, present the two payment preferences as TOGGLE SWITCHES the customer flips, plus a single proceed button, instead of asking two yes/no questions. Emit a fenced block: three backticks then the word `toggles`, then `title: Before payment`, then `default: on` so both switches start enabled, then `- save_card_consent: Save my card for future payments`, then `- auto_renew_consent: Enable auto-renewal so my box renews automatically next time`, then `confirm: Proceed to payment`, then a closing line of three backticks. When the customer proceeds, record save_card_consent and auto_renew_consent with collect_field from the toggle results and mark auto-renew ACTIVE in the submission if it was on. ";
const NEW =
  "This journey runs WITHOUT sign-in, so do NOT offer to save the card and do NOT offer auto-renewal: Emirates Post has no account to keep a card against, and auto-renewal would have nothing to charge. Never emit a toggles block for either, and never record save_card_consent or auto_renew_consent here. If the customer asks for either, say plainly that both need an Emirates Post account, and offer to continue as a guest or to sign in. ";
const OLD_SAVED_CARD =
  "At payment: if a saved card is on file, use it directly; otherwise capture the card via the payment gateway. ";
const NEW_SAVED_CARD = "At payment: a guest has no card on file, so send them to the payment page. ";

interface Journey { key: string; guidance?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key) || typeof j.guidance !== "string") continue;
    let g = j.guidance;
    if (g.includes(OLD)) g = g.split(OLD).join(NEW);
    if (g.includes(OLD_SAVED_CARD)) g = g.split(OLD_SAVED_CARD).join(NEW_SAVED_CARD);
    if (g === j.guidance) { console.log(`  (skip) ${j.key}`); continue; }
    j.guidance = g;
    changed++;
    console.log(`  + ${j.key}: account-only options removed from the payment step`);
  }

  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
