/**
 * Put the rental payment back on our own gateway (2026-08-30).
 *
 * Reverting the switch made earlier today, at the client's request, while
 * Emirates Post's API team are asked what the intended flow actually is. Their
 * gateway route ends in a 157 on Save seconds after a Select that succeeded and
 * returned a hold reference — the reservation exists and the order creation
 * cannot find it — which is a question for them, not something to keep guessing
 * at from this side.
 *
 * Removing confirmTool drops the journey back to pricing-only mode: real
 * availability, real hold, authoritative price from the backend, then payment
 * through the internal checkout and submit_case to finalise. That also
 * re-arms the save-before-pay gate on its own, since the gate applies to any
 * paid journey whose apiFlow has a saveTool and no confirmTool.
 *
 * Everything learned along the way stays: the hold chain, uniqueBoxId, the
 * injected billingDetail, the 60s write timeout, the honest reporting of an
 * unpaid order. None of it is specific to whose gateway takes the money.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/revert-nxn-rental-to-internal-gateway-2026-08-30.ts [--env <file>]
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

const GATEWAY_NOTE_START = "PAYMENT RUNS ON EMIRATES POST'S GATEWAY (2026-08-30).";
const INTERNAL_NOTE = [
  "RECORDING THE RENTAL (internal checkout). Take the payment through the internal checkout first — call request_payment with the total from the hold — and only once it is 'paid' call post_api_Rental_Save ONCE to record the rental with Emirates Post, then give the customer the reference from its response.",
  "KNOWN AND UNRESOLVED: Save may answer 157 ERROR_GETTING_HOLD_DETAILS even seconds after a Select that succeeded and returned a hold reference. If it does, the customer HAS been charged on our gateway and the box is NOT recorded: say exactly that, give them the hold reference and the payment reference, and arrange a callback. Do not claim the booking is complete, and do not retry the save more than once.",
].join(" ");

interface Journey {
  key: string;
  submission?: { apiFlow?: { saveTool?: string; confirmTool?: string; notes?: string; paymentReturnUrl?: string } };
  [k: string]: unknown;
}

async function main() {
  const agent = await getAgentBySlug(SLUG);
  if (!agent) throw new Error(`${SLUG} not found`);
  const db = getDb();

  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  const def = row!.definition as unknown as { journeys: Journey[] };
  let changed = 0;
  for (const j of def.journeys) {
    const f = j.submission?.apiFlow;
    if (f?.saveTool !== "post_api_Rental_Save") continue;
    const before = JSON.stringify(f);
    delete f.confirmTool;
    delete f.paymentReturnUrl;
    const notes = String(f.notes ?? "");
    if (notes.includes(GATEWAY_NOTE_START)) {
      // Replace the whole backend-gateway paragraph, up to the blank line.
      const i = notes.indexOf(GATEWAY_NOTE_START);
      const end = notes.indexOf("\n\n", i);
      f.notes = (notes.slice(0, i) + INTERNAL_NOTE + (end === -1 ? "" : notes.slice(end))).trim();
    } else if (!notes.includes("RECORDING THE RENTAL (internal checkout)")) {
      f.notes = `${INTERNAL_NOTE}\n\n${notes}`.trim();
    }
    if (JSON.stringify(f) === before) { console.log(`  (skip) ${j.key} — already internal`); continue; }
    changed++;
    console.log(`  + ${j.key}: confirmTool removed, ordering note restored`);
  }
  if (changed) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row!.id));

  // Leave the confirm operation switched off so it cannot be called by accident.
  let disabled = 0;
  for (const r of await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id))) {
    const envs = r.environments as Record<string, { operations?: { toolName?: string; enabled?: boolean }[] }>;
    let hit = false;
    for (const env of Object.values(envs ?? {})) {
      for (const op of env?.operations ?? []) {
        if (op.toolName !== CONFIRM || !op.enabled) continue;
        op.enabled = false;
        hit = true;
        disabled++;
        console.log(`  - disabled ${CONFIRM}`);
      }
    }
    if (hit) await db.update(agentIntegrations).set({ environments: envs as never }).where(eq(agentIntegrations.id, r.id));
  }
  console.log(`\n${changed} journey(s) reverted, ${disabled} operation(s) disabled.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
