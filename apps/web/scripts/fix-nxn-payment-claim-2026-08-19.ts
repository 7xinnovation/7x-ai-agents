/**
 * Never tell a customer their payment went through unless it did (2026-08-19).
 *
 * Reported from staging: the customer accepted the terms, had NOT reached the
 * payment step, and the agent replied "Your payment went through, but the
 * booking could not be recorded at this time due to a session issue with the
 * backend."
 *
 * That sentence is mine. The rule added this morning reads "say plainly that the
 * payment went through but the booking could not be recorded yet" — written on
 * the assumption that a save only fails AFTER payment. Rental/Save 401s without a
 * session, so it fails at any point, and the model repeated the script verbatim
 * including the half that was not true.
 *
 * Telling someone they have paid when they have not is worse than the failure it
 * was describing: they stop watching for the charge and have no reason to check
 * their statement.
 *
 * The wording is now conditional on the payment state the agent can actually see,
 * and the "payment went through" half exists only in the branch where it did.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-payment-claim-2026-08-19.ts [--env <file>]
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
const MARKER = "WHAT TO SAY WHEN THE SAVE FAILS (2026-08-19):";

/** The unconditional sentences added this morning, which presumed payment. */
const OLD = [
  "Say plainly that the payment went through but the booking could not be recorded yet, that the team will follow up, and offer a callback.",
  "tell the customer honestly that their payment went through but the box could not be reserved yet and that the team will follow up, and offer a callback.",
  "If the call fails, say plainly that the payment went through but the renewal could not be recorded, and offer a callback",
];

const RULE = [
  `${MARKER} Before describing a failed save, check the case's payment status — what you say depends on it, and getting it wrong is worse than the failure itself.`,
  "- Payment status is 'paid': say their payment went through but the booking could not be recorded yet, that the team will follow up, and offer a callback.",
  "- Payment status is anything else (none, initiated, failed): NOTHING HAS BEEN CHARGED. Say the booking cannot be completed right now, say explicitly that they have NOT been charged, and offer a callback. Never say or imply a payment succeeded — a customer who believes they have paid stops watching for the charge and has no reason to check their statement.",
  "This applies however the save failed: an error, a session the backend rejected, or a tool you cannot find.",
].join("\n");

interface Journey {
  key: string;
  guidance?: string;
  submission?: { apiFlow?: { notes?: string; saveTool?: string } };
  [k: string]: unknown;
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = 0;
  for (const j of def.journeys) {
    if (!j.submission?.apiFlow?.saveTool) continue;
    let g = String(j.guidance ?? "");
    let notes = String(j.submission.apiFlow.notes ?? "");
    const before = `${g}||${notes}`;

    // Remove the unconditional wording wherever it appears, then state the rule once.
    for (const o of OLD) {
      g = g.split(o).join("");
      notes = notes.split(o).join("");
    }
    if (!g.includes(MARKER)) g = `${g.trimEnd()}\n\n${RULE}`;

    if (`${g}||${notes}` === before) {
      console.log(`  (skip) ${j.key}`);
      continue;
    }
    j.guidance = g;
    j.submission.apiFlow.notes = notes;
    changed++;
    console.log(`  + ${j.key}`);
  }

  if (!changed) {
    console.log("nothing to do");
    return;
  }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
