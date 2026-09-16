/**
 * Require sign-in before a NEW postal-activity licence (2026-09-16).
 *
 * The readiness gate's "Identity or verified ownership precedes the transaction"
 * check was met by five of the six services and failed on one: EPGL's new
 * licence. A guest could enter, pay for and submit a brand-new licence request
 * with no sign-in and no lookup proving they hold anything — identity rested
 * entirely on the documents a person checked AFTER submission.
 *
 * EPGL renewal already requires auth (requiresAuth: true, both on the intent and
 * the journey), and the product owner confirmed on 16 September that "UAE Pass is
 * implemented over all the services" (FB-1737). New-licence issuance is at least
 * as sensitive as renewal, so it gets the same gate: this flips requiresAuth on
 * the `new_license` journey AND its routing intent to true.
 *
 * The flag is enforced server-side, not by prompt: set_journey, request_payment
 * and submit_case all refuse an auth-required journey for an unauthenticated
 * customer (packages/core/src/ai/tools.ts). Flipping it here is the whole fix.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-new-licence-requires-auth-2026-09-16.ts [--env <file>] [--dry-run]
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
const JOURNEY_KEY = "new_license";
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();
  const row = await db.query.agents.findFirst({ where: eq(agents.slug, SLUG) });
  if (!row) throw new Error(`agent ${SLUG} not found in this database`);

  const def = row.definition as {
    journeys?: { key: string; requiresAuth?: boolean }[];
    intents?: { key: string; journey?: string; requiresAuth?: boolean }[];
  };

  const journey = (def.journeys ?? []).find((j) => j.key === JOURNEY_KEY);
  if (!journey) throw new Error(`journey ${JOURNEY_KEY} not found on ${SLUG}`);
  // The intent that routes into the journey — matched by journey link first, key as fallback.
  const intent = (def.intents ?? []).find((i) => i.journey === JOURNEY_KEY || i.key === JOURNEY_KEY);

  const before = { journey: journey.requiresAuth ?? false, intent: intent?.requiresAuth ?? false };
  if (before.journey && before.intent) {
    console.log(`✓ Already enforced — ${SLUG}/${JOURNEY_KEY} requiresAuth is true on both the journey and its intent. Nothing to do.`);
    process.exit(0);
  }

  journey.requiresAuth = true;
  if (intent) intent.requiresAuth = true;

  console.log(`${SLUG}/${JOURNEY_KEY}: requiresAuth journey ${before.journey} → true, intent ${before.intent} → true${intent ? "" : " (no routing intent found — journey flag is the enforced one)"}`);

  if (dryRun) {
    console.log("— dry run, nothing written —");
    process.exit(0);
  }

  await db.update(agents).set({ definition: def as never, updatedAt: new Date() }).where(eq(agents.slug, SLUG));
  console.log("✓ Saved.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
