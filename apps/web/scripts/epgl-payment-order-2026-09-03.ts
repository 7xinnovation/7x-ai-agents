/**
 * Tell the EPGL journeys WHEN to take payment (2026-09-03).
 *
 * requiresPayment was on, the gateway was bound, the fee was declared -- and no
 * payment card ever appeared. The journeys carry an apiFlow, and an apiFlow makes
 * the rendered guidance say "this journey is completed through the integration
 * tools -- finish it there", so the model ran the duplicate check, submitted, and
 * stopped. Nothing in EPGL's own guidance mentioned money, because when it was
 * written EPGL had no gateway.
 *
 * ORDER MATTERS, and it is the opposite of the generic apiFlow wording. Our
 * webhook notifies Salesforce with `notifyPayment.salesforceId`, which is the
 * licence request's id -- it does not exist until the request is submitted. So:
 *
 *   duplicate check -> submitLicenseRequest -> request_payment -> webhook notifies
 *
 * Paying first would leave a settled payment with nothing to attach it to.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-payment-order-2026-09-03.ts [--env <file>] [--dry-run] [--remove]
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
const DRY = process.argv.includes("--dry-run");
const REMOVE = process.argv.includes("--remove");
const JOURNEYS = ["new_license", "renewal"];
const MARKER = "PAYMENT — AFTER SUBMISSION, NEVER BEFORE";

const GUIDANCE =
  `${MARKER}. This journey is chargeable, and the payment comes AFTER the licence request exists — not before, and ` +
  `not instead of submitting. The order is: duplicate check, then the save tool, THEN payment. ` +
  `\n\n1. Submit the request with the save tool and keep the reference it returns. ` +
  `\n2. In the SAME turn, call request_payment. A secure payment card appears in the chat by itself — never paste a ` +
  `link and never quote a payment URL. Say what you are doing in the words the customer needs: they have just ` +
  `confirmed their application, so "submitting your application and bringing up payment" tells them what happens ` +
  `next. "Let me submit your application now", with a payment step they have not been warned about, does not. ` +
  `\n3. Tell the customer what they are paying and WAIT. Do not say the application is complete, approved or done ` +
  `while payment status is anything other than "paid": it is submitted and awaiting payment, and saying otherwise ` +
  `tells someone their licence is being processed when no money has moved. ` +
  `\n\nNEVER STATE A FEE BEFORE request_payment HAS RETURNED ONE. Not in the summary, not in a sentence like "the ` +
  `annual licensing fee is X", not from anything you have read or remember — the amount lives in the configuration ` +
  `and is the only figure that will actually be charged. Quoting a number from memory and then charging a different ` +
  `one is worse than saying nothing: the customer has been told a price that is not the price. Until the tool has ` +
  `returned, say only that a fee applies and that you will bring up the exact amount. ` +
  `\n\nDo NOT work out the total yourself. request_payment returns the figure to quote, already complete — quote ` +
  `exactly what it returns and add nothing to it. If it names any fee alongside the licence fee, show that as its ` +
  `own line; if it names none, there is none, and inventing a processing or admin fee tells the customer they are ` +
  `paying something they are not. Never call request_payment before the save tool has returned a reference: the ` +
  `payment is reported to Salesforce against that reference, and a payment taken first has nothing to attach to.`;

interface Journey { key: string; guidance?: string }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key)) continue;
    const g = String(j.guidance ?? "");
    const has = g.includes(MARKER);
    if (REMOVE) {
      if (!has) { console.log(`  (already) ${j.key}: no payment guidance`); continue; }
      j.guidance = g.split("\n\n").filter((p) => !p.includes(MARKER)).join("\n\n").trim();
      changed++;
      console.log(`  - ${j.key}: payment guidance removed`);
      continue;
    }
    if (has) { console.log(`  (already) ${j.key}: payment guidance present`); continue; }
    // FIRST, so it is read before the flow it corrects.
    j.guidance = `${GUIDANCE}\n\n${g}`.trim();
    changed++;
    console.log(`  + ${j.key}: payment guidance`);
  }

  const missing = JOURNEYS.filter((k) => !def.journeys.some((j) => j.key === k));
  if (missing.length) throw new Error(`journeys not found on ${SLUG}: ${missing.join(", ")}`);
  if (!changed) { console.log("\nnothing to do."); return; }
  if (DRY) { console.log(`\n--dry-run: ${changed} change(s) not written.`); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} change(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
