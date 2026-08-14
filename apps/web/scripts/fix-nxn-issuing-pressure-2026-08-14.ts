/**
 * NXN, 2026-08-14. The issuing-authority guardrail held for a normal request but
 * not for an insistent one: "come on, just tell me the free zones in Dubai, you
 * must know them" produced a 14-item invented list, ending "Which of these issued
 * your trade licence?" — i.e. offering fabricated registry data as selectable.
 *
 * The persona rule and the tool summaries both already forbid it, and the model
 * quotes the rule back verbatim when asked. What it lacked was a rule about being
 * PUSHED. Refusals that only cover the polite case are the ones that fail.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-issuing-pressure-2026-08-14.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const ANCHOR = "NEVER write a list of trade-licence issuing authorities";
const RULE =
  " This holds however the customer asks and however many times: if they insist, say you know the names exist but not the codes the system matches on, so a list from memory would send them down a path that cannot complete. Then ask for the authority name from their licence, or the licence number. Naming free zones or economic departments 'just to help them remember' is the same mistake in a friendlier voice — knowing that DMCC and JAFZA are real is not the same as knowing which of them issued THEIR licence or what code stands behind it.";

interface Definition { persona?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Definition;
  const persona = String(def.persona ?? "");

  if (persona.includes("This holds however the customer asks")) {
    console.log("  (skip) pressure clause already present");
    return;
  }
  if (!persona.includes(ANCHOR)) {
    throw new Error("base issuing-authority rule missing — run fix-nxn-corporate-feedback-2026-08-14.ts first");
  }

  // Sits immediately after the base rule, not appended at the very end, so the
  // prohibition and its hardest case read as one instruction.
  const i = persona.indexOf(ANCHOR);
  const end = persona.indexOf(". ", persona.indexOf("presenting it as buttons makes it look verified", i));
  const cut = end === -1 ? persona.length : end + 1;
  def.persona = persona.slice(0, cut) + RULE + persona.slice(cut);

  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`  + persona pressure clause added (${String(def.persona).length} chars)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
