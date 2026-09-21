/**
 * The AED 100,700 that production was never going to charge (2026-09-21).
 *
 * Asked to confirm the production licence fee, and it is right: both EPGL
 * journeys carry `amount: 100700`, no processing fee, no surcharges, and the
 * approved penalties are added on top by the server for a renewal. The number
 * is correct and it is never collected.
 *
 * `submission.requiresPayment` defaults to FALSE and is absent from both
 * production journeys. Staging has it true. Two things follow, and the runtime
 * was checked rather than reasoned about:
 *
 *   request_payment  -> "This journey does not require payment." The tool
 *                       refuses outright; adapters.payment.initiate is reached
 *                       from nowhere else, so production EPGL cannot charge.
 *   submit_case      -> the paid-before-submit gate does not apply, so a licence
 *                       application or renewal files with nothing paid.
 *
 * This may well be deliberate: the fee was an open question with Emirates Post
 * until this week, and switching payment off is a sane way to hold a live
 * service that must not take the wrong amount. So this script exists, is
 * idempotent, changes nothing else, and is NOT to be run until someone decides
 * the fee is settled.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-requires-payment-2026-09-21.ts [--env <file>] [--dry-run]
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

const SLUG = "epgl-dialog";
/** The published tariff. Confirmed 2026-09-21; already what both journeys hold. */
const EXPECTED_AMOUNT = 100700;
const JOURNEYS = ["new_license", "renewal"];
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`No agent ${SLUG} in this database`);
  const def = row.definition as any;
  let changes = 0;

  for (const key of JOURNEYS) {
    const j = (def.journeys ?? []).find((x: any) => x.key === key);
    if (!j) throw new Error(`${SLUG} has no journey "${key}" here`);
    const sub = j.submission ?? (j.submission = {});

    // REFUSE TO TURN PAYMENT ON AT THE WRONG PRICE. The whole point of the
    // change is that the configured fee is the one that gets charged, so a
    // figure that is not the agreed one means someone is about to collect
    // something nobody agreed to.
    if (sub.amount !== EXPECTED_AMOUNT) {
      throw new Error(
        `${key}: amount is ${sub.amount}, expected ${EXPECTED_AMOUNT} — refusing to enable payment at a price nobody confirmed`
      );
    }
    if (sub.processingFee || (sub.surcharges ?? []).length) {
      throw new Error(`${key}: carries a processing fee or surcharge; check it before enabling payment`);
    }

    if (sub.requiresPayment === true) {
      console.log(`  ${key}: already requires payment`);
      continue;
    }
    console.log(`  ${key}: requiresPayment ${JSON.stringify(sub.requiresPayment)} -> true  (amount ${sub.amount} ${sub.currency})`);
    sub.requiresPayment = true;
    changes++;
  }

  if (!changes) {
    console.log("\nAlready applied — nothing to change.");
    return;
  }
  if (dryRun) {
    console.log(`\n--dry-run: ${changes} change(s) NOT written.`);
    return;
  }
  await db.update(agents).set({ definition: def }).where(eq(agents.id, row.id));
  console.log(`\n${changes} change(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
