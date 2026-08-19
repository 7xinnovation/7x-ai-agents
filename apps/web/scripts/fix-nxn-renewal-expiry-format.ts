/**
 * Renewal pricing: keep the box's own expiry DAY, not a hardcoded 31 December.
 *
 * The apiFlow notes told the model to send expiryDate as "YYYY-12-31T00:00:00".
 * Verified against box 82039 (DXB), whose real expiry is 2024-12-30:
 *
 *   expiryDate 2026-12-31  ->  HTTP 400  "SYSTEM SYSTEM ERROR: PLEASE CONTACT SUPPORT TEAM"
 *   expiryDate 2026-12-30  ->  HTTP 200  amount 1595
 *
 * One day out and Emirates Post rejects it. The day and month must come from the
 * box's currentExpiryDate; only the YEAR changes.
 *
 * That single mistake produced both faults the customer saw.
 *
 * The visible one: with Pricing failing, the model filled the duration cards
 * from the bundle's base rate instead — 1 Year at AED 995, the Basic Box annual
 * price. The real prices for those exact expiry dates are 1595 / 2095 / 4200. So
 * the customer chose "1 Year — AED 995" and the summary then charged AED 1,595,
 * which was the correct price all along. The card was wrong, not the total.
 *
 * That is also why this matters more than a formatting nit: an expired box is not
 * renewed a year at a time. This one lapsed in 2024, so bringing it to 2026 costs
 * roughly two years. Showing the bundle's annual rate on that card understates
 * the price by 600 dirhams and the customer only discovers it at payment.
 *
 * The second fault: at "Proceed to payment" the model re-fetched Pricing — which
 * the notes already tell it not to do — hit the same 400, and offered a callback.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-renewal-expiry-format.ts [--env <file>]
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
const MARKER = "EXPIRY DATE (2026-08-19):";

/** The instruction that was wrong, in both renewal journeys' apiFlow notes. */
const WRONG = "formatted YYYY-12-31T00:00:00";
const RIGHT = "formatted with the box's OWN day and month from currentExpiryDate and only the year changed (see the expiry-date rule below)";

const RULE =
  `${MARKER} The expiryDate you send to Pricing and to the save MUST reuse the DAY and MONTH of the box's currentExpiryDate from the Details response, changing only the year. ` +
  "If currentExpiryDate is 2024-12-30T00:00:00 then one year on is 2026-12-30T00:00:00, NOT 2026-12-31T00:00:00. One day out is rejected with \"SYSTEM SYSTEM ERROR: PLEASE CONTACT SUPPORT TEAM\", which reads like a backend outage and is not one. " +
  "NEVER hardcode 31 December. " +
  "AN EXPIRED BOX IS NOT RENEWED A YEAR AT A TIME: if currentExpiryDate is already past, the first option brings it to the next FUTURE anniversary, which may be two or more years of fees. Take every price from the Pricing tool for that exact expiryDate — the bundle's annual rate is NOT the price of the first option and using it understates what the customer will be charged. " +
  "If Pricing fails for a duration, do not show a price for it at all: say you cannot retrieve prices right now and offer a callback. A duration card carrying a price the customer will not actually be charged is worse than no card.";

interface Journey { key: string; submission?: { apiFlow?: { notes?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = 0;
  for (const j of def.journeys) {
    const flow = j.submission?.apiFlow;
    if (!flow) continue;
    let notes = String(flow.notes ?? "");
    const before = notes;

    if (notes.includes(WRONG)) notes = notes.split(WRONG).join(RIGHT);
    if (!notes.includes(MARKER)) notes = `${notes.trimEnd()} ${RULE}`;

    if (notes === before) {
      console.log(`  (skip) ${j.key}: already correct`);
      continue;
    }
    flow.notes = notes;
    changed++;
    console.log(`  + ${j.key}${before.includes(WRONG) ? " (replaced the 12-31 instruction)" : ""}`);
  }

  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
