/**
 * Return from Emirates Post's payment page to a page that can act (2026-08-30).
 *
 * paymentReturnUrl was the host site, so after paying the popup sat on the
 * Emirates Post homepage: the window stayed open, the customer could not tell
 * whether it had worked, and the chat behind it knew nothing. It now returns to
 * /api/payments/ext-return, which is same-origin with the embed — so it can tell
 * the chat the customer is back, and close itself.
 *
 * It deliberately claims nothing about the outcome. Only UpdatePayment can say
 * whether the money arrived, and a redirect is customer-controlled.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/set-nxn-payment-return-2026-08-30.ts [--env <file>] [--host <url>]
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
const hostArg = process.argv.indexOf("--host");
const HOST = hostArg !== -1 ? process.argv[hostArg + 1]! : process.env.PUBLIC_APP_URL ?? "https://7xagents.7x-lab.com";
const RETURN_URL = `${HOST.replace(/\/$/, "")}/api/payments/ext-return`;

interface Journey { key: string; submission?: { apiFlow?: { saveTool?: string; paymentReturnUrl?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;
  for (const j of def.journeys) {
    const f = j.submission?.apiFlow;
    if (f?.saveTool !== "post_api_Rental_Save") continue;
    if (f.paymentReturnUrl === RETURN_URL) { console.log(`  (skip) ${j.key} — already ${RETURN_URL}`); continue; }
    console.log(`  + ${j.key}: ${f.paymentReturnUrl ?? "(unset)"} -> ${RETURN_URL}`);
    f.paymentReturnUrl = RETURN_URL;
    changed++;
  }
  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
