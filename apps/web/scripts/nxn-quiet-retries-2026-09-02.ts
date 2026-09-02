/**
 * Do not narrate a retry to the customer (2026-09-02).
 *
 * Mid-purchase the customer read: "The serviceCriteria values need to match the
 * enum. Retrying with the correct enum values", then "The backend expects AED
 * 400 — the agent fee appears only once in the total. Let me resend with the
 * correct amount." Both were true, both were ours, and neither meant anything to
 * someone trying to rent a PO Box — they watched a fee appear and then vanish.
 *
 * The two causes are fixed in code. This is the standing rule.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-quiet-retries-2026-09-02.ts [--env <file>]
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

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const MARKER = "RETRIES ARE NOT NARRATED (2026-09-02)";
const NOTE = `

${MARKER}: when a call is rejected and you are going to try again, say NOTHING about it. No field names, no enum values, no "the backend expects", no "let me resend". The customer is buying a PO Box; a validation error between us and Emirates Post is not their business and reads as something going wrong with their money. Keep the reply on what they are waiting for — "creating your order" — and let the retry happen inside it.
NEVER let a price change in front of them. If you have shown a total and then discover it was wrong, that is a mistake they should not have seen: quote the figure from the hold, which is given to you outright, and quote it once.
This does NOT apply when the customer must act: a rejected area, an expired hold, a payment that did not go through. Those are theirs to know, and the tools say so plainly when it happens.`;

interface Journey { key: string; submission?: { apiFlow?: { notes?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;
  for (const j of def.journeys) {
    const f = j.submission?.apiFlow;
    if (!f) continue;
    if (String(f.notes ?? "").includes(MARKER)) { console.log(`  (skip) ${j.key}`); continue; }
    f.notes = String(f.notes ?? "") + NOTE;
    changed++;
    console.log(`  + ${j.key}`);
  }
  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
