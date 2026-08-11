/**
 * Speed + stability: retire NXN integration operations the journeys never use.
 *
 * Profiling a renewal turn (2026-08-11) showed the model calling the
 * AUTHENTICATED get_api_Renewal_Details first, getting an auth failure, and
 * re-calling the guest variant on a second round. That wrong guess cost a whole
 * model round (~2.5s) on every renewal, and it is a guess the tool list invites:
 * four different operations look like "renewal details", three of which no
 * journey uses.
 *
 * Every disabled operation also leaves the tool schema, which is re-sent on
 * every round, so this shrinks the per-round payload as well.
 *
 * SAFE BY CONSTRUCTION: an operation is only disabled if it is in the candidate
 * list below AND no journey references it (checked against every journey's
 * apiFlow tool names and guidance text). Anything referenced is skipped and
 * reported. Idempotent, and reversible by flipping `enabled` back to true.
 *
 * Run from apps/web:  npx tsx scripts/trim-nxn-tools.ts [--apply]
 * Without --apply it only reports what it would do.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents, agentIntegrations } from "@dialog/db";
import { eq } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

/**
 * Operations the journeys do not use. Each is either an AUTHENTICATED duplicate
 * of a guest operation the renewal flow is required to use, or an endpoint for
 * a service this assistant does not offer (cancellation, rejected boxes,
 * agent management — those live in the PO Box management portal).
 */
const CANDIDATES = [
  "get_api_Renewal_Details",                        // duplicate of Guest_Renewal_Details (the wrong-guess culprit)
  "get_api_Rental_renewaldetails",                  // a third renewal-details variant
  "get_api_Renewal_GetRenewedByOptions",            // duplicate of the Guest variant
  "get_api_Renewal_GetChargesForAdditionalServices",// duplicate of the Guest variant
  "get_api_Renewal_AdditionalDetails",              // authenticated add-ons; guest flow does not use them
  "get_api_Renewal_GetAdditionalOptions",           // authenticated add-ons; guest flow does not use them
  "get_api_Renewal_GetAgents",                      // agent management is not a journey here
  "get_api_Renewal_ValidateCancel",                 // cancellation is not a journey here
  "get_api_Rental_GetRejectedBoxDetails",           // rejected-box handling is not a journey here
];

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  const def = agent.definition as Record<string, any>;
  const activeEnv = def.activeEnvironment ?? "production";

  // Everything the journeys reference, by tool name and by guidance mention.
  const referenced = new Set<string>();
  const guidanceBlob = JSON.stringify(def.journeys ?? {});
  for (const j of def.journeys ?? []) {
    const af = j.submission?.apiFlow ?? {};
    for (const k of ["detailsTool", "pricingTool", "saveTool", "confirmTool"]) {
      if (af[k]) referenced.add(String(af[k]).split("__").pop()!);
    }
  }

  const rows = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id));
  let disabled = 0, skipped = 0, already = 0, remaining = 0;

  for (const row of rows) {
    const envs = (row.environments ?? {}) as Record<string, any>;
    const spec = envs[activeEnv];
    if (!spec?.operations) continue;
    let changed = false;

    for (const op of spec.operations) {
      const name: string = op.toolName;
      const isCandidate = CANDIDATES.includes(name);
      if (!isCandidate) {
        if (op.enabled !== false) remaining++;
        continue;
      }
      if (op.enabled === false) { already++; continue; }
      // Guard: never disable something a journey points at or names in guidance.
      if (referenced.has(name) || guidanceBlob.includes(name)) {
        console.log(`  SKIP    ${name}  (referenced by a journey)`);
        skipped++; remaining++;
        continue;
      }
      console.log(`  disable ${name}`);
      op.enabled = false;
      changed = true;
      disabled++;
    }

    if (changed && APPLY) {
      await db.update(agentIntegrations).set({ environments: envs }).where(eq(agentIntegrations.id, row.id));
    }
  }

  console.log(
    `\n  ${APPLY ? "applied" : "DRY RUN (pass --apply to write)"}: ` +
    `${disabled} disabled, ${already} already off, ${skipped} skipped as referenced.`
  );
  console.log(`  tools the model will still see: ~${remaining}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
