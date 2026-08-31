/**
 * The AED 25 was a declared surcharge (2026-08-31).
 *
 * Rewriting the journey text and the knowledge base did not stop the figure
 * appearing on the key-delivery card, because it was also a surcharge on the
 * journey's submission — and those go into the system prompt as "ADD-ON FEES you
 * must disclose UP FRONT: Key delivery (courier) = 25 AED". The model was doing
 * as it was told.
 *
 * Emirates Post prices key delivery per bundle (30 for the ones checked) and does
 * not offer it for MyHome at all. The only figure we may show comes from
 * priceDetails on the Rental/Select response, and the amount charged comes from
 * the hold — so nothing here needs a locally declared fee.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-drop-courier-surcharge-2026-08-31.ts [--env <file>]
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
const KEY = "key_delivery_fee";

interface Journey {
  key: string;
  submission?: { surcharges?: { key: string; amount: number }[] };
  [k: string]: unknown;
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    const sub = j.submission;
    const list = sub?.surcharges;
    if (!list?.some((x) => x.key === KEY)) continue;
    const kept = list.filter((x) => x.key !== KEY);
    if (kept.length) sub!.surcharges = kept;
    else delete sub!.surcharges;
    changed++;
    console.log(`  + ${j.key}: dropped ${KEY}`);
  }

  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
