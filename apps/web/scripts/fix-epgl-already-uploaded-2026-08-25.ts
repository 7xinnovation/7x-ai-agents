/**
 * Do not ask for a document that is already uploaded (2026-08-25).
 *
 * Reported from staging. The customer uploaded the trade licence from the
 * opening card, before being asked. The agent read it correctly — company name,
 * licence number, expiry, activities all landed in the case panel — took the
 * name and email, and then said:
 *
 *   "Now, here's what you should have ready before we continue: Trade Licence …
 *    MOA … Owner's Emirates ID. Let's start with your trade licence. Upload it
 *    here:"
 *
 * and re-emitted the trade_license upload block, which rendered directly beneath
 * its own green "Uploaded — Postal License_Adb-0013207.pdf" card.
 *
 * The case state was never wrong: the model is given the Documents list and a
 * Submission readiness line naming what is missing. The guidance is simply a
 * numbered script — "0) capture name and email, then show the list … 1) collect
 * the documents one at a time, in this order: first the TRADE LICENSE" — and
 * nothing in it says what to do when the customer has already handed one over.
 * Arriving at step 1 after the step-0 detour, the model started step 1 at its
 * first item, exactly as written.
 *
 * So say it: the order is a collection order, not a replay, and the readiness
 * list decides where to resume. The general form of this rule now lives in the
 * platform prompt (packages/core/src/ai/prompt.ts); this is the EPGL half, next
 * to the script that caused it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-epgl-already-uploaded-2026-08-25.ts [--env <file>]
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
const MARKER = "ALREADY UPLOADED (2026-08-25):";

const RULE = [
  `${MARKER} Before every upload block, check the Documents list in the case state.`,
  '- A document whose status is "uploaded" or "accepted" is DONE. Never emit its upload block again and never list it as still needed. The customer can see it on screen marked Uploaded, and you have already told them what you read from it.',
  "- The numbered order below is the order to collect documents IN, not a script to replay from the top. Each time you come back to collecting documents, resume at the FIRST ONE STILL MISSING — the Submission readiness line names them.",
  '- The customer may upload something before you ask, or out of order. That has helped you: acknowledge what you got from it and continue from the first document still outstanding. Do not restart at the trade licence because it is item one.',
  '- The "what you should have ready" list is shown ONCE, and it reflects reality: mark anything already received as done rather than presenting it as outstanding. If everything on it is already in hand, do not show the list at all.',
].join("\n");

interface Journey {
  key: string;
  guidance?: string;
  [k: string]: unknown;
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = 0;
  for (const j of def.journeys) {
    const g = String(j.guidance ?? "");
    if (!g.includes("DOCUMENTS-FIRST")) {
      console.log(`  (skip) ${j.key} — not a documents-first journey`);
      continue;
    }
    if (g.includes(MARKER)) {
      console.log(`  (skip) ${j.key} — already applied`);
      continue;
    }
    // Ahead of the numbered steps, so it is read before the script is followed.
    const anchor = "0) START (before any upload)";
    j.guidance = g.includes(anchor) ? g.replace(anchor, `${RULE}\n\n${anchor}`) : `${g.trimEnd()}\n\n${RULE}`;
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
