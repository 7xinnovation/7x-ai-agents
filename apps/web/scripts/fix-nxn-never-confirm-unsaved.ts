/**
 * Never confirm a renewal or rental that was not recorded (2026-08-19).
 *
 * A real staging renewal: payment taken (AED 600, settled), and then the model
 * said "I need to call the Save endpoint to record the renewal. Let me do that
 * now — the Pricing tool was called in error for the save step. I'll proceed
 * with the information already confirmed", produced a renewal confirmation, and
 * EMAILED it to the customer. The case is still status=ready with no reference.
 * Nothing reached Emirates Post.
 *
 * The immediate cause was mine — the save operation was disabled, so the tool the
 * prompt told it to finish with did not exist. But the model's response to a
 * missing tool was to narrate the call and confirm anyway, and that would be
 * wrong even if the tool had merely been down. The apiFlow notes covered a save
 * that FAILS; they did not cover one that was never callable.
 *
 * So the rule is about the reference, not the tool: no reference, no
 * confirmation, and no confirmation email. A customer told their renewal is done
 * stops checking.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-never-confirm-unsaved.ts [--env <file>]
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
const MARKER = "NO REFERENCE, NO CONFIRMATION (2026-08-19):";

const RULE =
  `${MARKER} A rental or renewal is recorded ONLY when the save tool returns a reference. Until you are holding that reference from the tool's response: ` +
  "do NOT say it is confirmed, complete, recorded or successful; do NOT show a confirmation summary; do NOT send a confirmation email; and do NOT produce a reference of your own in any format. " +
  "If the save tool is missing from your tools, returns an error, or you find yourself about to describe calling it rather than calling it — that is the failure case. Say plainly that the payment went through but the booking could not be recorded yet, that the team will follow up, and offer a callback. " +
  "Narrating the step is not performing it. A customer told their renewal is done stops checking, so a wrong confirmation costs them the chance to fix it while the payment is still fresh.";

interface Journey { key: string; guidance?: string; submission?: { apiFlow?: { saveTool?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = 0;
  for (const j of def.journeys) {
    if (!j.submission?.apiFlow?.saveTool) continue;
    const g = String(j.guidance ?? "");
    if (g.includes(MARKER)) { console.log(`  (skip) ${j.key}`); continue; }
    j.guidance = `${g.trimEnd()}\n\n${RULE}`;
    changed++;
    console.log(`  + ${j.key}`);
  }
  if (!changed) { console.log("nothing to do — already applied"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
