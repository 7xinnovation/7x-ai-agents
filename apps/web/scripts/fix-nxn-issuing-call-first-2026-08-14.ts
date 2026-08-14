/**
 * NXN, 2026-08-14 — third pass on the issuing-authority list, and the last one
 * needed, because the data now actually flows.
 *
 * History: the agent was inventing the list, so the persona got a hard "NEVER
 * write a list of trade-licence issuing authorities" plus a pressure clause. Both
 * were correct at the time — the endpoint appeared to 401, so there genuinely was
 * no list. That 401 turned out to be a broken probe of mine (it sent the
 * encrypted api key string), and /api/Guest/GetIssuingEntitiesEscher in fact
 * returns 56 authorities on box-stg with the credentials we already hold.
 *
 * The guardrail then became the problem. Told emphatically and repeatedly that it
 * cannot produce this list, the model stopped CALLING the tool at all and went
 * straight to the fallback line — "I was unable to pull the list right now" —
 * without ever trying. Observed on staging in 3 of 3 runs after nxn_issuing_
 * authorities went live and was verified working against the same database.
 *
 * So the rule is re-pointed rather than removed: call the tool FIRST, every time;
 * the prohibition applies only to composing a list yourself, and the apology is
 * only for when the call actually fails. A refusal that fires before the attempt
 * is just a different way of getting the customer the wrong answer.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-issuing-call-first-2026-08-14.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const OLD_START = "NEVER write a list of trade-licence issuing authorities";
const MARKER = "ISSUING AUTHORITIES — CALL THE TOOL FIRST, ALWAYS.";

const RULE =
  `${MARKER} Whenever the customer asks which authorities exist, asks to pick from a list, or needs to identify the one that issued their licence, CALL nxn_issuing_authorities before you say anything about it. It returns the real registry — every authority with its code, English and Arabic name, emirate and free-zone flag. Do not decide in advance that you cannot help: you have this list, and refusing before you have called the tool is as wrong as inventing one. ` +
  "Show what it returns grouped by emirate, as buttons, and record the customer's choice with its entCode — the code is what every later lookup matches on. " +
  "The one thing you must never do is write a list from your own knowledge, or add to, pad out or 'complete' what the tool returned. If the call genuinely fails, say you cannot pull the list right now and ask for the authority name as printed on their licence, or the licence number. That apology is only ever for a call that was made and failed, never a substitute for making it.";

interface Definition { persona?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Definition;
  const persona = String(def.persona ?? "");

  if (persona.includes(MARKER)) {
    console.log("  (skip) call-first rule already present");
    return;
  }
  const i = persona.indexOf(OLD_START);
  if (i === -1) throw new Error("previous issuing-authority rule not found — persona has drifted");

  // Replace the whole previous block: the prohibition, the reasoning and the
  // pressure clause, all of which now read as "there is no list".
  const tailAnchor = "knowing that DMCC and JAFZA are real is not the same as knowing which of them issued THEIR licence or what code stands behind it.";
  const j = persona.indexOf(tailAnchor);
  const end = j === -1 ? persona.length : j + tailAnchor.length;

  def.persona = `${persona.slice(0, i)}${RULE}${persona.slice(end)}`.replace(/\s+/g, " ").trim();
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`  + persona re-pointed to call-first (${String(def.persona).length} chars)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
