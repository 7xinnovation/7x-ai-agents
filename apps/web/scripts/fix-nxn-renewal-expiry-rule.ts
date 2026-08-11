/**
 * Fix the renewal pricing date rule: it must be the box's OWN anniversary.
 *
 * Reported from production 2026-08-11 as "the pricing system is returning an
 * error". It was not the backend. Our guidance told the assistant to build the
 * target expiry as `YYYY-12-31`, which is only correct for boxes that happen to
 * expire on 31 December — and silently broke every other box.
 *
 * Verified against Emirates Post staging (three boxes, same payload otherwise):
 *   box 50500  expires 2025-12-31  →  2027-12-31  OK 1390   (12-31 works: it IS its anniversary)
 *   box  2500  expires 2025-12-30  →  2026-12-30  OK  995   /  2027-12-31 FAILS
 *   box  7777  expires 2025-12-27  →  2027-12-27  OK  600   /  2027-12-31 FAILS
 *   box  2500  expires 2025-12-30  →  2025-12-30  FAILS     (a past date is rejected)
 *
 * So: same month and day as the box's current expiry, year advanced by the
 * number of years renewed, and strictly in the future.
 *
 * Run from apps/web:  npx tsx scripts/fix-nxn-renewal-expiry-rule.ts [--apply]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const MARKER = "ANNIVERSARY DATE RULE";

const RULE =
  ` ${MARKER} — the single most important input to Pricing. expiryDate MUST be the box's OWN ANNIVERSARY: take currentExpiryDate from payload.poBoxRenewalDetails, keep the SAME MONTH AND DAY, and advance the YEAR by the number of years being renewed. Example: currentExpiryDate 2025-12-27 renewed for 2 years gives "2027-12-27T00:00:00". NEVER substitute 31 December or any other date — the backend rejects anything that is not that box's anniversary with "SYSTEM ERROR ... code 171" (verified: a box expiring 12-27 prices on 12-27 and errors on 12-31). The date must ALSO be strictly in the future: if the box has already lapsed, keep advancing whole years from its own anniversary until the date is in the future, and treat that first future anniversary as the 1-year option (so a box that expired 2025-12-30 renews to 2026-12-30 for one year). If Pricing still errors after a correctly-formed anniversary date, do NOT keep guessing dates: say the price could not be confirmed and offer a callback.`;

/** Sentences from the old, wrong rule that must not survive. */
const STALE = [/-12-31T00:00:00/g, /formatted YYYY-12-31T00:00:00/g, /BASE YEAR/g];

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  const def = agent.definition as Record<string, any>;
  let changed = false;

  for (const key of ["personal_po_box_renewal", "corporate_po_box_renewal"]) {
    const j = def.journeys.find((x: any) => x.key === key);
    const af = j?.submission?.apiFlow;
    if (!af) { console.log(`  ! ${key}: no apiFlow`); continue; }
    const before: string = af.notes ?? "";

    // Replace the old year-end formulations wherever they appear, then append
    // the authoritative rule once.
    let notes = before
      .replace(
        /expiryDate MUST be the NEW TARGET expiry = current expiry advanced by the chosen years[^.]*\./g,
        "expiryDate MUST be the NEW TARGET expiry = the box's current expiry with the SAME month and day and the year advanced by the chosen years."
      )
      .replace(
        /\(a\) expiryDate = \(BASE YEAR[^;]*;/g,
        "(a) expiryDate = the box's currentExpiryDate with the SAME month and day, year advanced by the number of renewal years, and strictly in the future;"
      )
      .replace(/, formatted YYYY-12-31T00:00:00,?/g, ", keeping the box's own month and day,")
      // The retry advice repeated the wrong format, so a failed call was retried
      // with the same wrong shape.
      .replace(
        /re-check the expiryDate \(future, YYYY-12-31 format\)/g,
        "re-check the expiryDate (a FUTURE anniversary of the box's own expiry — same month and day as currentExpiryDate)"
      );

    if (!notes.includes(MARKER)) notes += RULE;

    // The grace-period bullet in the GUIDANCE said to compute a lapsed box's new
    // expiry "from the CURRENT year", which together with the old year-end format
    // produced 31-12-<year> — a date the backend rejects. The grace intent is
    // right (a lapsed box still gets a full year); the arithmetic must run on the
    // box's own anniversary.
    const g: string = j.guidance ?? "";
    const fixedG = g.replace(
      /If the box's currentExpiryDate is already in the past, compute the new expiry from the CURRENT year instead of the lapsed expiry year \(see the pricing notes\)/g,
      "If the box's currentExpiryDate is already in the past, keep the box's own month and day and advance the year until the date is in the future — that first future anniversary is the 1-year option (a box that expired 30-12-2025 renews to 30-12-2026). Never move the date to 31 December (see the pricing notes)"
    );
    if (fixedG !== g) { j.guidance = fixedG; changed = true; console.log(`  ${key}: guidance grace-rule corrected`); }

    const stillStale = STALE.some((re) => re.test(notes.replace(RULE, "")));
    console.log(`  ${key}: ${before.length} → ${notes.length} chars${stillStale ? "   ⚠ stale 12-31 wording still present" : ""}`);
    if (notes !== before) { af.notes = notes; changed = true; }
  }

  if (APPLY && changed) {
    await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));
    console.log("\n  applied.");
  } else {
    console.log(`\n  ${APPLY ? "no change needed." : "DRY RUN — pass --apply to write."}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
