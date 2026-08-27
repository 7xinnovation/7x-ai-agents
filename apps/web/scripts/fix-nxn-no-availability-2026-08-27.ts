/**
 * Say availability is unavailable rather than inventing numbers (2026-08-27).
 *
 * Four boxes picked in a row, four rejections:
 *   POST /api/Rental/Select -> 400 {"ERROR_CODE":"108","ERROR_MESSAGE":"BOX_NOT_FREE"}
 *
 * The numbers were never real. Emirates Post staging publishes no availability at
 * some branches, so FreeBoxes comes back empty and a deterministic set is
 * substituted (BLOCKERS 1/4b) — evenly spaced, generated from bundle+location.
 * That was harmless while nothing checked them. Now that we hold the box before
 * charging, Select checks, and every one comes back BOX_NOT_FREE — which reads to
 * the customer as "someone beat me to it", four times, on boxes nobody could ever
 * have taken.
 *
 * lib/integrations.ts no longer substitutes them once the hold operation is
 * enabled. This tells the agent what to do with the empty list it will now get.
 *
 * Not every branch is empty: Naif Post Office returned 378781/378785/378790/378795
 * — irregular spacing, nothing like the generated pattern — so real inventory
 * exists in staging and the honest answer is branch-specific.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-no-availability-2026-08-27.ts [--env <file>]
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
const MARKER = "WHEN A BRANCH HAS NO BOXES (2026-08-27):";

const NOTE = [
  `${MARKER} If the availability call returns no box numbers, that branch has none to offer.`,
  "Say so plainly and name the branch, and offer to try a different one. Do NOT invent numbers, do NOT re-run the same call hoping for a different answer, and do NOT present an empty list as though it were a choice.",
  'If a box you try to hold comes back BOX_NOT_FREE (code 108), it is genuinely taken. Say so, offer the customer the next branch, and NEVER say "these boxes are being taken quickly" — you do not know that, and repeating it while every single number fails tells the customer a story instead of the truth.',
  "After TWO failed holds at the same branch, stop offering numbers there. Move to another branch, or say availability cannot be confirmed right now and offer a callback.",
].join("\n");

interface Journey { key: string; guidance?: string; submission?: { apiFlow?: { saveTool?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = 0;
  for (const j of def.journeys) {
    if (j.submission?.apiFlow?.saveTool !== "post_api_Rental_Save") { console.log(`  (skip) ${j.key}`); continue; }
    const g = String(j.guidance ?? "");
    if (g.includes(MARKER)) { console.log(`  (skip) ${j.key} — already applied`); continue; }
    j.guidance = `${g.trimEnd()}\n\n${NOTE}`;
    changed++;
    console.log(`  + ${j.key}`);
  }
  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
