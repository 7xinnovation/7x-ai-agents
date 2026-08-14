/**
 * Give "show what they already have" a real source (2026-08-14).
 *
 * The corporate journey's Stage 2A says "once the company is identified, show its
 * existing corporate PO Boxes before creating a new one, to avoid duplicates" —
 * and names no tool. That is the same shape that produced an invented list of
 * issuing authorities and invented box numbers: an instruction to show something,
 * with nothing to show it from. The personal journey has no equivalent at all,
 * though "what do I already have" is the same question.
 *
 * nxn_boxes_for_customer now exists for exactly this. It reads
 * /users/api/v1/PoBoxes/getpoboxesbymobile keyed on the customer's Emirates ID,
 * which is the closest the API comes to the original ask — "show what they have
 * under their Emirates ID". There is no companies-by-Emirates-ID lookup anywhere
 * in the surface (five endpoints accept an Emirates ID; none returns companies;
 * no other service prefix exists), so PO Boxes is what that phrase can mean here.
 *
 * The Emirates ID comes from the introspected session, never from the customer.
 * A typed one would let anyone enumerate someone else's boxes.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/wire-customer-boxes-into-journeys.ts [--env <file>] [--dry-run]
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
const dryRun = process.argv.includes("--dry-run");
const MARKER = "WHAT THEY ALREADY HAVE (2026-08-14):";

const RULE =
  `${MARKER} As soon as the customer is signed in, and BEFORE walking them through creating another box, call nxn_boxes_for_customer with the VERIFIED Emirates ID from the known-customer note to see what they already hold. ` +
  "Show what it returns and ask whether they want another one, or whether they meant to renew or manage an existing box — a customer who already has a box usually wants one of those. " +
  "Never ask them to type their Emirates ID for this: it comes from their signed-in session, and a typed one would let anyone list someone else's boxes. " +
  "If it returns nothing, say so plainly and carry on — that is the normal answer for a first-time customer, not an error. " +
  "If it cannot run, continue with the journey and do not describe boxes you have not read.";

interface Journey { key: string; guidance?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = 0;
  for (const j of def.journeys) {
    // Both rental journeys, and the manage flow, ask "what do you already have".
    if (!j.key.includes("rental") && j.key !== "manage_po_box") continue;
    const g = String(j.guidance ?? "");
    if (g.includes(MARKER)) {
      console.log(`  (skip) ${j.key}: already wired`);
      continue;
    }
    j.guidance = `${g.trimEnd()}\n\n${RULE}`;
    changed++;
    console.log(`  + ${j.key}`);
  }

  if (!changed) {
    console.log("nothing to do — already applied");
    return;
  }
  if (dryRun) {
    console.log("\n--dry-run, nothing written");
    return;
  }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) now read the customer's existing boxes instead of describing them unsourced.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
