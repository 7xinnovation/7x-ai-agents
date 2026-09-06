/**
 * A rental has never counted as a submission.
 *
 * `submission.apiFlow.saveTool` names the tool whose success means the journey
 * completed. The orchestrator compares it to the tool actually called —
 * `tu.name === saveTool` — and the tool is named with its integration's prefix:
 * `nxnstaging__post_api_Rental_Save`. Both rental journeys record it WITHOUT the
 * prefix, so the comparison has never once matched.
 *
 * Everything hung off that event is therefore missing for every PO Box rental
 * ever made through this agent:
 *   - the `case_submitted` audit row
 *   - the journey.completed / crm.case.created analytics
 *   - notifyOpsForSubmission — the key-delivery request to the branch, the
 *     MyHome hand-off to the EMX team, and the note telling an authorised agent
 *     they have been added to a box
 *
 * The renewals were unaffected: theirs carry the prefix and always have.
 *
 * The prefix is derived from the integration's own name rather than assumed, so
 * this is right in any environment. Idempotent.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-fix-savetool-2026-09-06.ts [--env <file>] [--dry-run]
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

const DRY = process.argv.includes("--dry-run");
/** The same prefix buildApiTools gives a tool. */
const prefix = (name: string) => name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14).toLowerCase() || "api";

interface Journey { key: string; submission?: { apiFlow?: { saveTool?: string; confirmTool?: string } } }

async function main() {
  const db = getDb();
  const rows = await db.select().from(agents);
  let changed = 0;

  for (const row of rows) {
    const def = row.definition as unknown as { journeys?: Journey[] };
    if (!def.journeys?.length) continue;
    const integrations = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, row.id));
    // Every tool name this agent can produce, so a bare suffix can be resolved
    // to exactly one full name — and left alone if it matches more than one.
    const toolNames: string[] = [];
    for (const intg of integrations) {
      for (const env of Object.values((intg.environments ?? {}) as Record<string, { operations?: { toolName?: string }[] }>)) {
        for (const op of env?.operations ?? []) {
          if (op?.toolName) toolNames.push(`${prefix(intg.name)}__${op.toolName}`.slice(0, 64));
        }
      }
    }
    let touched = false;
    for (const j of def.journeys) {
      const flow = j.submission?.apiFlow;
      if (!flow) continue;
      for (const field of ["saveTool", "confirmTool"] as const) {
        const cur = flow[field];
        if (!cur || cur.includes("__")) continue;
        const matches = [...new Set(toolNames.filter((t) => t.endsWith(`__${cur}`)))];
        if (matches.length !== 1) {
          console.log(`  ! ${row.slug}/${j.key}.${field}: "${cur}" matches ${matches.length} tools — left alone`);
          continue;
        }
        console.log(`  ~ ${row.slug}/${j.key}.${field}: ${cur} -> ${matches[0]}`);
        flow[field] = matches[0]!;
        touched = true;
        changed++;
      }
    }
    if (touched && !DRY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
    }
  }

  console.log(changed ? (DRY ? `\n--dry-run: ${changed} not written.` : `\n${changed} written.`) : "\nnothing to do.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
