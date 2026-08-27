/**
 * Start the payment preference switches ON (2026-08-27).
 *
 * Requested for NXN: "Save my card" and "Enable auto-renewal" should already be
 * on when the block renders, so the customer taps Proceed rather than flipping
 * two switches first.
 *
 * The renderer now supports a `default: on` line in a ```toggles block; this puts
 * it in the guidance that emits the block. Switches only — the acknowledgment
 * variant (`style: checkbox`) ignores it, because a pre-ticked terms box is not
 * an acknowledgment, and the T&C block must stay unticked.
 *
 * Note the consent still has to be READ BACK from what the customer submits: a
 * default that was left alone is a choice they made, but a switch they turned OFF
 * must be recorded as off. The existing rule "never enable auto-renew without
 * explicit consent" is unchanged.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-toggles-default-on-2026-08-27.ts [--env <file>]
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
const ANCHOR = "`title: Before payment`";
const INSERT = "`title: Before payment`, then `default: on` so both switches start enabled";

interface Journey { key: string; guidance?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = 0;
  for (const j of def.journeys) {
    const g = String(j.guidance ?? "");
    if (!g.includes(ANCHOR)) { console.log(`  (skip) ${j.key} — no toggles block`); continue; }
    if (g.includes("`default: on`")) { console.log(`  (skip) ${j.key} — already applied`); continue; }
    j.guidance = g.split(ANCHOR).join(INSERT);
    changed++;
    console.log(`  + ${j.key}`);
  }

  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
