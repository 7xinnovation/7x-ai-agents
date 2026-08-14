/**
 * Close the box-number gap before it becomes the authority-list problem again.
 *
 * /api/Rental/FreeBoxes is the ONLY rental read that needs the signed-in session
 * — Bundle, BoxLocations and ExpiryDates all answer on the api key alone:
 *
 *   Rental/Bundle        200      Rental/FreeBoxes            401
 *   Rental/BoxLocations  200      Rental/GetRejectedBoxDetails 401
 *   Rental/ExpiryDates   200
 *
 * So on production the rental journey walks the customer through bundle, emirate
 * and branch on real data, and then reaches the box-number step with nothing to
 * show. That is the exact shape that produced an invented list of issuing
 * authorities: a tool that cannot answer, and a customer waiting for a list.
 *
 * It is the same trap, too. The summary read "(requires UAE PASS)", which taught
 * the model not to bother calling it for a guest — and with no tool result to
 * work from it filled the gap itself. Prose did not hold there: the guidance
 * already said "NEVER invent bundles, branches, box numbers, prices or dates",
 * and the model produced a list anyway. What worked was making the tool the only
 * route and its failure explicit.
 *
 * The cost here is worse than a wrong list. A fabricated box number is one the
 * customer then PAYS for, through the live gateway, before Rental/Save refuses it.
 *
 * Staging is unaffected: its deterministic reserved-box fallback still answers, so
 * this only changes what happens where there is genuinely nothing to show.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-box-numbers-2026-08-14.ts [--env <file>]
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
const MARKER = "BOX NUMBERS — CALL THE TOOL FIRST, ALWAYS.";

const SUMMARIES: Record<string, string> = {
  "/api/Rental/FreeBoxes":
    "THE ONLY source of available PO Box numbers. ALWAYS call this before showing the customer any box number, and show ONLY numbers it returned. If it reports an error or that sign-in is needed, say plainly that you cannot show available boxes until they are signed in, and continue once they are — do not offer numbers from anywhere else. A box number you made up is one the customer will pay for and never receive.",
  "/api/Rental/GetRejectedBoxDetails":
    "Details of a box rejected during a rental. Needs the signed-in session; if it is unavailable, say so rather than describing a rejection you have not read.",
};

const RULE =
  `${MARKER} Box numbers come only from the Rental/FreeBoxes tool. Call it before you present any, and present only what it returned. ` +
  "If it cannot answer — it needs the customer's Emirates Post session — tell them you cannot list available boxes until they sign in, and pick the journey back up afterwards. " +
  "Do not fill the gap with plausible-looking numbers: unlike a wrong branch name, a box number the customer chooses is one they then PAY for, and the booking will be refused afterwards because the box was never real. Saying you cannot show them yet is always the better answer.";

interface Journey { key: string; guidance?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) throw new Error(`${SLUG} not found`);

  // 1. Tool descriptions — the layer that actually changed behaviour last time.
  let ops = 0;
  for (const row of await db.select().from(agentIntegrations).where(eq(agentIntegrations.agentId, agent.id))) {
    const envs = (row.environments ?? {}) as Record<string, { operations?: Array<Record<string, unknown>> }>;
    let touched = false;
    for (const [envName, spec] of Object.entries(envs)) {
      for (const op of spec.operations ?? []) {
        const want = SUMMARIES[String(op.path)];
        if (!want || op.summary === want) continue;
        console.log(`  ~ [${row.name}/${envName}] ${op.path}`);
        op.summary = want;
        touched = true;
        ops++;
      }
    }
    if (touched) await db.update(agentIntegrations).set({ environments: envs as never }).where(eq(agentIntegrations.id, row.id));
  }

  // 2. Journey guidance, for the rental journeys that reach this step.
  const def = agent.definition as unknown as { journeys: Journey[] };
  let guided = 0;
  for (const j of def.journeys) {
    if (!j.key.endsWith("_rental")) continue;
    const g = String(j.guidance ?? "");
    if (g.includes(MARKER)) {
      console.log(`  (skip) ${j.key}: rule already present`);
      continue;
    }
    j.guidance = `${g.trimEnd()}\n\n${RULE}`;
    guided++;
    console.log(`  + ${j.key}: box-number rule`);
  }
  if (guided) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, agent.id));

  console.log(ops || guided ? `\nupdated ${ops} operation summaries and ${guided} journeys.` : "\nnothing to do — already applied");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
