/**
 * Set auto-renewal explicitly after a rental (2026-08-31).
 *
 * The consent toggle has been going into Rental/Save as
 * isAutomaticSubscriptionEnabled since the journey was built, and it does not move
 * the box's own switch: 450294 was rented with it ON and the portal shows OFF.
 * The portal never relies on the save either — its switch calls
 * UpdateAutoRenewConfig, which is now behind nxn_set_auto_renew.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-auto-renew-2026-08-31.ts [--env <file>]
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
const JOURNEYS = ["personal_po_box_rental", "corporate_po_box_rental"];
const MARKER = "AUTO-RENEWAL (2026-08-31)";
const NOTE = `

${MARKER}: the consent toggle you send on the save does NOT switch the box's auto-renewal on. It is a payment-properties flag; the box's own setting is moved only by nxn_set_auto_renew, which is what the portal's switch calls. So once the rental is confirmed and paid, call nxn_set_auto_renew ONCE with the box number, the emirate and the choice the customer actually made — including when they chose no, because the default cannot be relied on either way. If it reports it could not be set, the rental is still fine: say auto-renewal is not on yet and that they can switch it on from their PO Box page. Never retry it and never let it turn a completed rental into a failure.`;

interface Journey { key: string; submission?: { apiFlow?: { notes?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;
  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key)) continue;
    const f = j.submission?.apiFlow;
    if (!f) { console.log(`  ! ${j.key} has no apiFlow`); continue; }
    if (String(f.notes ?? "").includes(MARKER)) { console.log(`  (skip) ${j.key}`); continue; }
    f.notes = String(f.notes ?? "") + NOTE;
    changed++;
    console.log(`  + ${j.key}`);
  }
  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
