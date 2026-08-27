/**
 * Tell the rental flow what Rental/Save actually needs (2026-08-27).
 *
 * The operation now carries its real schema (see refresh-nxn-body-schemas), so
 * the model can see the four required fields. Three of them it can fill from what
 * it already holds. `subscriptionReferenceNumber` it cannot: the spec never says
 * where that value comes from, and Rental/Select — the obvious candidate — is
 * documented as returning bundle items, because every response in that spec is
 * typed with the same wrapper. So state the best available answer, and say
 * plainly what to do when it is wrong instead of calling a 400 an outage.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-rental-save-fields-2026-08-27.ts [--env <file>]
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
const MARKER = "RENTAL/SAVE REQUIRED FIELDS (2026-08-27):";

const NOTE = [
  `${MARKER} The tool schema now lists them; all four are required and the call 400s without any one of them.`,
  "- totalAmount: the number actually charged, matching the payment exactly.",
  "- userProfile: the signed-in customer — customerNameEN, mobileNumber, email, idNumber. Take these from the known customer record or what they gave you; never invent an Emirates ID.",
  "- paymentProperties: at minimum paymentReturnUrl, plus saveCreditCard and isAutomaticSubscriptionEnabled from the consent toggles the customer set.",
  "- subscriptionReferenceNumber: use the payment reference from the settled payment. THIS ONE IS UNCONFIRMED — Emirates Post has not documented where it comes from.",
  "IF IT STILL RETURNS 400: read the field names in the response and say exactly which ones the backend rejected. Do NOT describe a validation error as a system issue, an outage, or a problem on Emirates Post's end — it is a malformed request, and mislabelling it sends the customer to a support queue that cannot help. The customer HAS been charged at this point, so say that plainly, say the box is not yet reserved, and offer the callback.",
].join("\n");

interface Journey { key: string; guidance?: string; submission?: { apiFlow?: { notes?: string; saveTool?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };

  let changed = 0;
  for (const j of def.journeys) {
    const flow = j.submission?.apiFlow;
    if (flow?.saveTool !== "post_api_Rental_Save") { console.log(`  (skip) ${j.key}`); continue; }
    const notes = String(flow.notes ?? "");
    if (notes.includes(MARKER)) { console.log(`  (skip) ${j.key} — already applied`); continue; }
    flow.notes = `${notes.trimEnd()}\n\n${NOTE}`;
    changed++;
    console.log(`  + ${j.key}`);
  }

  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
