/**
 * Make the issuing-authority lookup the ONLY route to that list (NXN, 2026-08-14).
 *
 * QA: "he asks me to write the trade license issuance instead of drop list, I asked
 * for the list" — and when asked, the agent produced a list of authorities it had
 * invented (DIFC, DMCC, JAFZA, DSO, …). Verified on staging: that list is in no
 * definition, no KB doc, and no API response — /api/MOE/GetIssuingEntities and
 * /api/Guest/GetIssuingEntitiesEscher both 401 today.
 *
 * A prose rule did not hold. The persona now carries "NEVER write a list of
 * trade-licence issuing authorities…", the model quotes it back verbatim when
 * asked, and then produces the list anyway on the next turn — it loses to the
 * platform contract's "present options as CARDS/buttons" and to plain helpfulness.
 *
 * The reason it improvises is that the tool it should reach for is described as
 * "(requires UAE PASS)", so with a guest it does not even try, and nothing else
 * answers the question. This rewrites those summaries into instructions: always
 * call, and what the refusal means. A tool result is a far stronger signal to the
 * model than a sentence in the system prompt.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-issuing-entity-tools-2026-08-14.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents, agentIntegrations } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";

/**
 * `entityCode` is documented by the backend as "Entity code from
 * GetIssuingEntities" — an ISSUING AUTHORITY code, not an Emirates ID. There is no
 * Emirates-ID-keyed lookup in this API: the customer's Emirates ID only appears in
 * the ownerDetails[] of GetEntitiesByLicenseNo, i.e. as something to CHECK a
 * licence against, never as something to search by. The summaries say so, so the
 * model stops trying to pass an Emirates ID into entityCode.
 */
const SUMMARIES: Record<string, string> = {
  "/api/MOE/GetIssuingEntities":
    "THE ONLY SOURCE for the list of trade-licence issuing authorities. ALWAYS call this when the customer asks which authorities there are, or asks to pick from a list — never answer that question from your own knowledge, and never render a list of authorities you were not given here. If it returns an error, tell the customer you cannot pull the list right now and ask them to type the authority name on their licence, or give you the trade licence number instead. No params.",
  "/api/Guest/GetIssuingEntitiesEscher":
    "Guest fallback for the list of trade-licence issuing authorities. Try this if the MOE list is unavailable. Same rule: the list of authorities may ONLY come from one of these two tools, never from your own knowledge. No params.",
  "/api/MOE/GetEntitiesById":
    "List the companies registered under ONE issuing authority. entityCode is the authority's code from GetIssuingEntities — it is NOT an Emirates ID and never accepts one. Use it to help the customer identify their company after they have chosen the authority.",
  "/api/MOE/GetEntitiesByLicenseNo":
    "Look up one company by its trade licence number. entityCode is the issuing authority's code from GetIssuingEntities (NOT an Emirates ID). Returns the company plus its owners, each with an Emirates ID — that is how ownership is checked: compare the customer's Emirates ID against the owners returned, never search by it.",
};

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) throw new Error(`${SLUG} not found`);

  const rows = await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id));
  let touched = 0;

  for (const row of rows) {
    const envs = (row.environments ?? {}) as Record<string, { operations?: Array<Record<string, unknown>> }>;
    let changed = false;
    for (const [envName, spec] of Object.entries(envs)) {
      for (const op of spec.operations ?? []) {
        const want = SUMMARIES[String(op.path)];
        if (!want || op.summary === want) continue;
        console.log(`  ~ [${row.name}/${envName}] ${op.path}`);
        op.summary = want;
        changed = true;
        touched++;
      }
    }
    if (changed) {
      await db.update(agentIntegrations).set({ environments: envs as never }).where(eq(agentIntegrations.id, row.id));
    }
  }

  console.log(touched ? `updated ${touched} operation summaries.` : "nothing to do — already applied");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
