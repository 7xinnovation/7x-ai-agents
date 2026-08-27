/**
 * Hold the box before saving the rental (2026-08-27).
 *
 * Second failure on the same paid rental. The four missing fields are gone; what
 * came back instead was:
 *
 *   POST /api/Rental/Save -> 400
 *   {"errorDetails":{"ERROR_CODE":"157","ERROR_MESSAGE":"ERROR_GETTING_HOLD_DETAILS"}}
 *
 * The backend is looking up a HOLD against the subscriptionReferenceNumber we
 * sent, and we sent our own payment UUID, which means nothing to it. Reading the
 * spec for what produces a hold: Rental/FreeBoxes takes a HoldReferenceNumber
 * query parameter and Rental/Select takes holdReferenceNumber in its body, so
 * Select is the step that reserves the chosen box — and it is DISABLED, so the
 * rental has been going straight from box choice to payment to Save with nothing
 * ever held.
 *
 * Enabling Select and calling it when the customer picks their box.
 *
 * WHAT IS STILL INFERRED: that Select's response carries the reference Save wants.
 * Every response in that spec is typed with the same PoBoxBundleItemListAPIResponse
 * wrapper, so the documented shape says "bundle items" for all of them and cannot
 * be trusted. The guidance therefore says to read the reference out of whatever
 * Select actually returns, and to report precisely if there is nothing there —
 * rather than falling back to the payment reference, which is what produced this.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-rental-hold-2026-08-27.ts [--env <file>]
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
const TOOL = "post_api_Rental_Select";
const MARKER = "HOLD THE BOX FIRST (2026-08-27):";

const NOTE = [
  `${MARKER} Rental/Save does not create the reservation on its own — it expects a hold that already exists, and returns ERROR_GETTING_HOLD_DETAILS (code 157) when it cannot find one.`,
  "As soon as the customer picks their box number, and BEFORE taking payment, call post_api_Rental_Select with bundleId (the chosen bundle), uniqueBoxID (the chosen box number) and poBoxExpiryDate (the expiry for the chosen duration).",
  "Read the reference out of the Select response and use THAT as subscriptionReferenceNumber on Rental/Save. Our own payment reference is NOT that value — sending it is what produced the 157.",
  "If Select fails, or its response contains no reference you can identify: STOP. Do not take the payment, because the box cannot be recorded afterwards. Say the box could not be reserved right now, that they have NOT been charged, and offer a callback.",
  "If Save still returns 157 after a successful Select, say exactly that — the hold was created but Save could not find it — and give the support team both references. Do not describe it as a payment problem.",
].join("\n");

interface Journey { key: string; submission?: { apiFlow?: { notes?: string; saveTool?: string } }; key2?: string; [k: string]: unknown }

async function main() {
  const agent = await getAgentBySlug(SLUG);
  if (!agent) throw new Error(`${SLUG} not found`);
  const db = getDb();

  // 1. Enable the hold operation.
  const rows = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id));
  let enabled = 0;
  for (const row of rows) {
    const envs = row.environments as Record<string, { operations?: { toolName?: string; enabled?: boolean }[] }>;
    let hit = false;
    for (const env of Object.values(envs ?? {})) {
      for (const op of env?.operations ?? []) {
        if (op.toolName !== TOOL) continue;
        if (op.enabled) { console.log(`  (skip) ${TOOL} already enabled`); continue; }
        op.enabled = true; hit = true; enabled++;
        console.log(`  + enabled ${TOOL}`);
      }
    }
    if (hit) await db.update(agentIntegrations).set({ environments: envs as never }).where(eq(agentIntegrations.id, row.id));
  }

  // 2. Tell the rental journeys to use it.
  const [arow] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  const def = arow!.definition as unknown as { journeys: Journey[] };
  let noted = 0;
  for (const j of def.journeys) {
    const flow = j.submission?.apiFlow;
    if (flow?.saveTool !== "post_api_Rental_Save") continue;
    const notes = String(flow.notes ?? "");
    if (notes.includes(MARKER)) { console.log(`  (skip) ${j.key} — already applied`); continue; }
    flow.notes = `${notes.trimEnd()}\n\n${NOTE}`;
    noted++;
    console.log(`  + ${j.key}`);
  }
  if (noted) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, arow!.id));

  console.log(`\n${enabled} operation(s) enabled, ${noted} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
