/**
 * NXN corporate rental, QA round 2026-08-14. Two items, both behavioural:
 *
 *  2. "The agent did not ask me about adding agent add-on service, I did ask him."
 *     Stage 4 (Add Agent) exists but nothing told the agent to OFFER it — it only
 *     described what to do once add_agent was already recorded. So it waited to be
 *     asked. Now it must offer once, as a buttons block, before the summary.
 *
 *  3. "Here he asks me to write the trade license issuance instead of drop list,
 *     I asked for the list."
 *     The worse half of this: when the customer did ask, the agent produced a
 *     list of issuing authorities (ADGM, KIZAD, TwoFour54, DSO, …) that it made
 *     up. That list is not in the definition, not in the knowledge base, and not
 *     from the API — /api/MOE/GetIssuingEntities and /api/Guest/
 *     GetIssuingEntitiesEscher both return 401 on staging today, because the GSB
 *     credential is not wired yet. Plausible names, invented codes: if a customer
 *     picks one we have no entCode to send anywhere.
 *
 *     So the rule is not "show a dropdown" — we cannot until GSB is live. It is
 *     "never invent one". Ask for the authority by name, or take the trade
 *     licence number directly, and say the details get confirmed from the
 *     document. When GetIssuingEntities starts answering, the existing
 *     "where the entity-lookup tools respond" path renders the real list and
 *     this guardrail stops applying on its own.
 *
 * Idempotent (keyed on MARKER). Run from apps/web:
 *   npx tsx scripts/fix-nxn-corporate-feedback-2026-08-14.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const MARKER = "CORPORATE QA (2026-08-14):";

/** Item 3 — the sentence that let the model fill the gap itself. */
const OLD_ENTITY =
  "Ask the issuing entity and, where the entity-lookup tools respond, use them ONLY to help the customer identify their company (one company → confirm it with them, several → let them pick).";
const NEW_ENTITY =
  "Ask the issuing entity and, where the entity-lookup tools respond, use them ONLY to help the customer identify their company (one company → confirm it with them, several → let them pick). " +
  "NEVER write the list of issuing authorities yourself. The only valid source is the entity-lookup tool. If it does not answer — it is not connected in every environment — say you cannot pull the list right now, and ask the customer to type the name of the authority that issued their licence, or to give you the trade licence number instead. " +
  "A list of authorities you composed from your own knowledge is wrong even when the names are real: the codes behind them are what the backend needs, and you do not have those. Offering it as a set of buttons makes an invented list look verified, which is worse than asking them to type it.";

/** The same instruction appears twice in this block, verbatim. Collapse it. */
const DUPE =
  "ask the customer to upload the trade license copy by emitting an upload block in that same reply ask the customer to upload the trade license copy by emitting an upload block in that same reply";
const DEDUPED = "ask the customer to upload the trade license copy by emitting an upload block in that same reply";

/**
 * Item 3, agent level. The journey rule alone is not enough: a customer can ask
 * "which authorities are there?" before any journey starts — and does, because the
 * corporate flow asks them to sign in first. Verified on staging: with only the
 * journey rule applied, the pre-sign-in agent still produced a full invented list
 * of emirates and then of Dubai authorities (DIFC, DMCC, JAFZA, …). The persona is
 * the only layer present on every turn.
 */
const PERSONA_RULE =
  "NEVER write a list of trade-licence issuing authorities from your own knowledge — not per emirate, not for the whole UAE, not as buttons or cards. That list may come ONLY from the entity-lookup tool. If the tool does not answer, say plainly that you cannot pull the list right now and ask the customer to type the name of the authority shown on their licence, or to give you the trade licence number instead. Authority names you recall may well be real, but the backend matches on codes you do not have, so an invented list sends the customer down a path that cannot complete — and presenting it as buttons makes it look verified.";

/** Item 2 — offer the agent add-on rather than waiting to be asked. */
const AGENT_RULE =
  `${MARKER} OFFER THE AUTHORISED AGENT — DO NOT WAIT TO BE ASKED. An authorised agent is an add-on the customer usually does not know exists, and corporate customers are the ones who most often need one. ` +
  "Once the trade licence details are captured and before you show the rental summary, offer it EXACTLY ONCE as a short line plus a ```buttons block with 'Add an authorised agent' and 'Not now'. " +
  "If they decline, set add_agent to 'no' and move on — do not raise it again in the same application. If they accept, follow Stage 4. " +
  "Never let the customer be the first to mention the authorised agent: by then they have already had to know to ask for it.";

interface Journey { key: string; guidance?: string; [k: string]: unknown }
interface Definition { journeys: Journey[]; persona?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Definition;

  const corp = def.journeys.find((j) => j.key === "corporate_po_box_rental");
  if (!corp) throw new Error("corporate_po_box_rental journey not found");

  const changes: string[] = [];

  // Agent level first — this is the layer that is present before any journey starts.
  const persona = String(def.persona ?? "");
  if (persona.includes("NEVER write a list of trade-licence issuing authorities")) {
    console.log("  (skip) persona already carries the issuing-authority guardrail");
  } else {
    def.persona = `${persona.trimEnd()} ${PERSONA_RULE}`;
    changes.push("persona: never invent the issuing-authority list");
  }

  let g = String(corp.guidance ?? "");

  if (g.includes(NEW_ENTITY)) {
    console.log("  (skip) issuing-authority guardrail already present");
  } else if (g.includes(OLD_ENTITY)) {
    g = g.replace(OLD_ENTITY, NEW_ENTITY);
    changes.push("issuing-authority guardrail (never invent the list)");
  } else {
    throw new Error("could not find the issuing-entity sentence to replace — guidance has drifted");
  }

  if (g.includes(DUPE)) {
    g = g.replace(DUPE, DEDUPED);
    changes.push("removed a duplicated upload instruction");
  }

  if (g.includes(MARKER)) {
    console.log("  (skip) agent add-on rule already present");
  } else {
    g = `${g.trimEnd()}\n\n${AGENT_RULE}`;
    changes.push("proactive authorised-agent offer");
  }

  if (!changes.length) {
    console.log("nothing to do — already applied");
    return;
  }
  corp.guidance = g;
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  for (const c of changes) console.log(`  + ${c}`);
  console.log(`corporate_po_box_rental guidance is now ${g.length} chars.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
