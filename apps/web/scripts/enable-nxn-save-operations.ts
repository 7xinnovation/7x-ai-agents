/**
 * Enable the save operations the journeys actually submit through (2026-08-19).
 *
 * Yesterday I set submission.apiFlow.saveTool on the NXN journeys and never
 * checked the operations behind them were callable. Every write on the
 * integration is `enabled: false`, and buildApiTools skips those — so the tool
 * the prompt told the model to "finish it there" with did not exist.
 *
 * What that produced, on a real staging renewal: payment taken (AED 600, paid),
 * the model narrating "I need to call the Save endpoint... I'll proceed with the
 * information already confirmed", a confirmation EMAIL to the customer, and a
 * case still sitting at status=ready with no reference. Nothing reached Emirates
 * Post. The apiFlow notes cover a save that FAILS; they do not cover a save that
 * was never there to call.
 *
 * Only the two the journeys reference are enabled. The rest of the writes stay
 * off, because they were disabled deliberately — an agent that can call every
 * write on a backend is a much bigger blast radius than one that can call the
 * two its journeys need.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/enable-nxn-save-operations.ts [--env <file>] [--dry-run]
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

const SLUG = "nxn-dialog";
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) throw new Error(`${SLUG} not found`);

  // The set is derived from the journeys, not hardcoded: if a journey's saveTool
  // changes, this enables the new one rather than a stale guess.
  const def = agent.definition as { journeys?: Array<{ key: string; submission?: { apiFlow?: { saveTool?: string } } }> };
  const needed = new Map<string, string[]>();
  for (const j of def.journeys ?? []) {
    const t = j.submission?.apiFlow?.saveTool;
    if (!t) continue;
    needed.set(t, [...(needed.get(t) ?? []), j.key]);
  }
  if (!needed.size) {
    console.log("no journey declares a saveTool — nothing to enable");
    return;
  }
  console.log("save tools the journeys submit through:");
  for (const [t, js] of needed) console.log(`  ${t}  <- ${js.join(", ")}`);
  console.log();

  let changed = 0;
  const seen = new Set<string>();
  for (const row of await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id))) {
    const envs = (row.environments ?? {}) as Record<string, { operations?: Array<Record<string, unknown>> }>;
    let touched = false;
    for (const [envName, spec] of Object.entries(envs)) {
      for (const op of spec.operations ?? []) {
        const tool = String(op.toolName ?? "");
        if (!needed.has(tool)) continue;
        seen.add(tool);
        if (op.enabled !== false) {
          console.log(`  (skip) [${envName}] ${tool} already enabled`);
          continue;
        }
        console.log(`  ${dryRun ? "would enable" : "   +   "} [${envName}] ${tool}`);
        op.enabled = true;
        touched = true;
        changed++;
      }
    }
    if (touched && !dryRun) {
      await db.update(agentIntegrations).set({ environments: envs as never }).where(eq(agentIntegrations.id, row.id));
    }
  }

  // A saveTool naming an operation that does not exist is the same silent
  // failure in a different disguise, so it is reported rather than ignored.
  for (const t of needed.keys()) {
    if (!seen.has(t)) console.log(`  ! ${t} is named by a journey but exists on NO environment — that journey cannot submit`);
  }

  console.log(changed ? `\n${dryRun ? "(dry run) " : ""}${changed} operation(s) enabled.` : "\nnothing to change");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
