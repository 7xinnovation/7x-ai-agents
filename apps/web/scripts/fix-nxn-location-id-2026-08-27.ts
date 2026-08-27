/**
 * LocationId is the branch's own officeId, not its parent (2026-08-27).
 *
 * The widget reports "Naif Post Office has no available box numbers" while the
 * same call, made directly with a live customer session, returns six:
 *
 *   FreeBoxes BundleId=IN LocationId=214  -> 6 boxes   (Naif's officeId)
 *   FreeBoxes BundleId=IN LocationId=209  -> 0 boxes   (Naif's mainOfficeId)
 *   FreeBoxes BundleId=IN LocationId=201  -> 0 boxes   (Dubai Central)
 *
 * BoxLocations gives every branch BOTH ids, and Naif's differ: officeId 214,
 * mainOfficeId 209 (Al Riqqa). Pick the wrong one and the answer is a perfectly
 * ordinary 200 with an empty list, which the agent then reports as the branch
 * being full. Nothing errors, so nothing was logged — that is now fixed
 * separately: an empty availability result records the parameters it asked with.
 *
 * Also worth knowing while testing: availability is genuinely branch-specific.
 * Dubai Central (201) has none, Naif (214) six, Al Badaa (233) eighty-two.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-location-id-2026-08-27.ts [--env <file>]
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
const MARKER = "WHICH BRANCH ID (2026-08-27):";

const NOTE = [
  `${MARKER} BoxLocations returns TWO ids per branch: officeId and mainOfficeId. They are often different — Naif Post Office is officeId 214 with mainOfficeId 209 (Al Riqqa).`,
  "LocationId for FreeBoxes is ALWAYS the branch's own officeId. Passing mainOfficeId returns a normal 200 with an empty list, and the customer is told their branch is full when it is not — Naif answers 214 with six boxes and 209 with none.",
  "So carry the officeId of the branch the customer picked, and pass that. Never substitute mainOfficeId, never re-derive the id from the branch name, and never reuse an id from a different call.",
  "An empty list is a real answer worth trusting only once you are sure you sent the right officeId. Availability really does vary by branch, so name the branch when you report it and offer another.",
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
