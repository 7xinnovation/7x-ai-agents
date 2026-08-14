/**
 * Submit NXN journeys to Emirates Post instead of to a mock (2026-08-14).
 *
 * Every NXN journey had submission.action = "crm.createCase", and crm is the mock
 * provider. Confirmed against the staging database: every submitted case carries
 * a reference like PER-9014 / COR-192871, which is the mock's own format
 * (journeyKey.toUpperCase().slice(0,3) + a counter). Not one real Emirates Post
 * reference exists.
 *
 * So the journey was genuine right up to and including taking the customer's
 * money through the live gateway, and then the step that would actually reserve
 * or renew the box never reached Emirates Post.
 *
 * The orchestrator already supports this: submission.apiFlow.saveTool names a
 * backend tool, and a successful call to it is emitted as the submission instead
 * of the internal submit_case. This fills that in.
 *
 * WHAT WORKS NOW vs WHAT WAITS, verified by POSTing an empty body to each (which
 * fails validation or auth before creating anything):
 *
 *   /api/Guest/Renewal/Save  400 field validation  -> guest tier, works TODAY
 *   /api/Renewal/Save        401 Bearer            -> needs the signed-in session
 *   /api/Rental/Save         401 Bearer            -> needs the signed-in session
 *
 * Renewals therefore start recording for real immediately. Rentals are wired to
 * the same mechanism but cannot complete until the Emirates Post session token
 * arrives from the NXN handoff — and that is the point: a rental that cannot be
 * recorded should say so, not hand the customer an invented reference for a box
 * nobody reserved.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/wire-nxn-real-submission.ts [--env <file>] [--dry-run]
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
const MARKER = "REAL SUBMISSION (2026-08-14)";

/**
 * The renewal save. Guest tier, so it works without a session — which is what
 * lets renewals record for real today.
 *
 * expiryDate is the NEW TARGET expiry, the same value the Pricing call was quoted
 * on. Sending the CURRENT expiry here would renew the box to a date it has
 * already reached, and the customer would have paid for nothing.
 */
const RENEWAL_SAVE_NOTES =
  `${MARKER}: RECORDING THE RENEWAL. After the payment settles, call post_api_Guest_Renewal_Save ONCE to record the renewal with Emirates Post. Until that call succeeds the renewal exists only as a payment — the box has not been renewed, so never tell the customer it is done before it returns. ` +
  "Send exactly what the pricing call was based on: boxNumber (integer), emirateCode (the 3-letter code), expiryDate as the NEW TARGET expiry in the same YYYY-12-31T00:00:00 form you sent to Pricing (NOT the current expiry — that would renew the box to a date it has already passed), newBundleId as the current bundle with isBundleChanged false unless the customer changed bundle, totalAmount exactly as charged, and renewedBy from the renewed-by options. " +
  "Take the reference from the response and give it to the customer as their renewal reference. If the call fails, say plainly that the payment went through but the renewal could not be recorded, and offer a callback — never invent a reference, and never retry it silently more than once.";

/**
 * The rental save. Protected: it 401s without a session, so it cannot complete
 * until the Emirates Post token reaches us from the NXN handoff.
 */
const RENTAL_SAVE_NOTES =
  `${MARKER}: RECORDING THE RENTAL. After the payment settles, call post_api_Rental_Save ONCE to create the PO Box rental with Emirates Post, then give the customer the reference from its response. ` +
  "This endpoint needs the customer's Emirates Post session. If it reports that a session is required, or fails for any other reason, tell the customer honestly that their payment went through but the box could not be reserved yet and that the team will follow up, and offer a callback. " +
  "NEVER present a reference you did not receive from this call: an invented reference sends the customer away believing they hold a box that nobody reserved.";

interface Journey {
  key: string;
  submission?: { action?: string; apiFlow?: { saveTool?: string; notes?: string } };
  [k: string]: unknown;
}

const WIRING: Record<string, { saveTool: string; notes: string }> = {
  personal_po_box_renewal: { saveTool: "post_api_Guest_Renewal_Save", notes: RENEWAL_SAVE_NOTES },
  corporate_po_box_renewal: { saveTool: "post_api_Guest_Renewal_Save", notes: RENEWAL_SAVE_NOTES },
  personal_po_box_rental: { saveTool: "post_api_Rental_Save", notes: RENTAL_SAVE_NOTES },
  corporate_po_box_rental: { saveTool: "post_api_Rental_Save", notes: RENTAL_SAVE_NOTES },
};

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = false;
  for (const j of def.journeys) {
    const w = WIRING[j.key];
    if (!w) {
      console.log(`  (skip) ${j.key}: not a submitting journey`);
      continue;
    }
    j.submission = j.submission ?? {};
    const flow = (j.submission.apiFlow = j.submission.apiFlow ?? {});
    if (flow.saveTool === w.saveTool && String(flow.notes ?? "").includes(MARKER)) {
      console.log(`  (skip) ${j.key}: already wired to ${w.saveTool}`);
      continue;
    }
    flow.saveTool = w.saveTool;
    // Keep whatever the flow already documented (the renewal pricing rules live
    // here and are hard-won); append rather than replace.
    const existing = String(flow.notes ?? "").trim();
    flow.notes = existing.includes(MARKER) ? existing : [existing, w.notes].filter(Boolean).join(" ");
    changed = true;
    console.log(`  + ${j.key}: saveTool = ${w.saveTool}`);
  }

  if (!changed) {
    console.log("nothing to do — already wired");
    return;
  }
  if (dryRun) {
    console.log("\n--dry-run, nothing written");
    return;
  }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log("\nSubmission now completes through Emirates Post, not the mock CRM.");
  console.log("Renewals record immediately (guest tier). Rentals wait on the session token.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
