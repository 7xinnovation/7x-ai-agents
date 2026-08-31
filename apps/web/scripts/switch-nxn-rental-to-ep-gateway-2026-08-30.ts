/**
 * Take the rental payment on Emirates Post's gateway, not ours (2026-08-30).
 *
 * Proved against staging: after a successful Rental/Save the box is reserved and
 * the order is UNPAID — the N-Genius order sits at state STARTED and
 * UpdatePayment answers {"isPaymentSuccess": false, "amountPaid": 0.0}. Save does
 * not record a payment taken elsewhere; it creates the order and OPENS a payment
 * on Emirates Post's own N-Genius outlet (b78ef8c7-…), returning a hosted
 * paymentUrl. We were charging on OUR outlet, so their order was never settled
 * and the box never appeared in the customer's portal.
 *
 * Two orders, one provider, different merchants, money in the wrong one.
 *
 * So the journey moves to the flow their API was built for, which the prompt
 * already renders once confirmTool is set:
 *
 *   Select (hold) -> Save (order + paymentUrl) -> customer pays on THEIR page
 *   -> UpdatePayment (verify) -> confirm only when isPaymentSuccess is true
 *
 * The ordering inverts: Save now runs BEFORE payment, because Save is what
 * creates the payment. Three things follow from that and are done here:
 *   - UpdatePayment is enabled and wired as confirmTool.
 *   - The note telling the model to save "after the payment settles" is replaced;
 *     it described the internal-checkout order and would deadlock this one.
 *   - paymentReturnUrl is set so the customer lands back on the host site.
 *
 * The save-before-pay gate is disabled for this shape separately, in the chat
 * route — it exists to stop a save being written before money is taken, and here
 * the save is how money gets taken.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/switch-nxn-rental-to-ep-gateway-2026-08-30.ts [--env <file>]
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

import { getDb, agents, agentIntegrations } from "@dialog/db";
import { eq } from "drizzle-orm";
import { getAgentBySlug } from "../lib/agents";

const SLUG = "nxn-dialog";
const CONFIRM = "post_api_Rental_UpdatePayment_paymentReferenceNo";
// Their gateway must return to a page of OURS, which closes the popup and tells
// the chat the customer is back. Returning to the host site leaves the window
// open on a homepage with the conversation none the wiser.
const HOST = process.env.PUBLIC_APP_URL ?? "https://7xagents.7x-lab.com";
const RETURN_URL = `${HOST.replace(/\/$/, "")}/api/payments/ext-return`;

const OLD_NOTE =
  "REAL SUBMISSION (2026-08-14): RECORDING THE RENTAL. After the payment settles, call post_api_Rental_Save ONCE to create the PO Box rental with Emirates Post, then give the customer the reference from its response.";
const NEW_NOTE = [
  "PAYMENT RUNS ON EMIRATES POST'S GATEWAY (2026-08-30). Rental/Save does not record a payment already taken — it CREATES the order and OPENS the payment. So it runs BEFORE any money moves, and it is the only way money reaches Emirates Post.",
  "Order: hold the box with Rental/Select, then call post_api_Rental_Save ONCE. Never call request_payment for this journey and never show the internal payment card — a payment taken there goes to a different merchant, leaves their order unpaid, and the box never appears in the customer's portal.",
  "Save returns paymentGateWayResponse.paymentUrl and paymentGateWayResponse.referenceNumber. Give the customer that EXACT URL to pay on, and keep the referenceNumber.",
  "When they say they have paid, call the confirm tool with that referenceNumber. Confirm the booking ONLY if it comes back isPaymentSuccess true — a response with isPaymentSuccess false means they have not paid yet, so say the payment has not come through and offer the link again. An orderNo alone is NOT a confirmed booking.",
].join(" ");

interface Journey {
  key: string;
  submission?: {
    apiFlow?: { saveTool?: string; confirmTool?: string; notes?: string; paymentReturnUrl?: string };
  };
  [k: string]: unknown;
}

async function main() {
  const agent = await getAgentBySlug(SLUG);
  if (!agent) throw new Error(`${SLUG} not found`);
  const db = getDb();

  // 1. The confirm operation has to exist as a tool before it can be named.
  let enabled = 0;
  for (const row of await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id))) {
    const envs = row.environments as Record<string, { operations?: { toolName?: string; enabled?: boolean }[] }>;
    let hit = false;
    for (const env of Object.values(envs ?? {})) {
      for (const op of env?.operations ?? []) {
        if (op.toolName !== CONFIRM || op.enabled) continue;
        op.enabled = true;
        hit = true;
        enabled++;
        console.log(`  + enabled ${CONFIRM}`);
      }
    }
    if (hit) await db.update(agentIntegrations).set({ environments: envs as never }).where(eq(agentIntegrations.id, row.id));
  }

  // 2. Point the rental journeys at it.
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  const def = row!.definition as unknown as { journeys: Journey[] };
  let changed = 0;
  for (const j of def.journeys) {
    const f = j.submission?.apiFlow;
    if (f?.saveTool !== "post_api_Rental_Save") continue;
    const before = JSON.stringify(f);
    f.confirmTool = CONFIRM;
    f.paymentReturnUrl = RETURN_URL;
    const notes = String(f.notes ?? "");
    f.notes = notes.includes(OLD_NOTE) ? notes.replace(OLD_NOTE, NEW_NOTE) : notes.includes("PAYMENT RUNS ON EMIRATES POST'S GATEWAY") ? notes : `${NEW_NOTE}\n\n${notes}`;
    if (JSON.stringify(f) === before) { console.log(`  (skip) ${j.key} — already applied`); continue; }
    changed++;
    console.log(`  + ${j.key}: confirmTool=${CONFIRM}, paymentReturnUrl set, ordering note replaced`);
  }
  if (changed) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row!.id));
  console.log(`\n${enabled} operation(s) enabled, ${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
