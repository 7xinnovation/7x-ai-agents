/**
 * The knowledge base should name the courier fee too (2026-09-01).
 *
 * It was rewritten on 31 Aug to stop asserting AED 25, which was wrong. AED 30
 * is the real figure, confirmed from GetChargesForAdditionalServices, so the
 * knowledge base can say so — with the same two caveats as everywhere else: the
 * charged amount comes from the hold, and MyHome does not offer it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-kb-courier-fee-2026-09-01.ts [--env <file>]
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

import { getDb, agents, kbChunks } from "@dialog/db";
import { eq, and, like } from "drizzle-orm";
import { embedTexts } from "@dialog/core";

const SLUG = "nxn-dialog";
const OLD =
  "Optional key delivery by courier carries a fee that Emirates Post sets per bundle — it is not a fixed AED 25, and some bundles (MyHome, where the key comes with the box) do not offer it at all. The amount comes from the live system when the box is reserved and is shown before payment; the assistant never quotes a figure of its own.";
const NEW =
  "Optional key delivery by courier costs AED 30, disclosed on the delivery option before the customer chooses. MyHome and MyHome Instant do not offer it — the key comes with the box. The exact amount is confirmed from the live system when the box is reserved and shown before payment.";

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) throw new Error(`${SLUG} not found`);

  const rows = await db
    .select()
    .from(kbChunks)
    .where(and(eq(kbChunks.agentId, agent.id), like(kbChunks.content, "%key delivery by courier%")));

  let changed = 0;
  for (const row of rows) {
    if (!row.content.includes(OLD)) { console.log(`  (skip) ${row.id}`); continue; }
    const content = row.content.split(OLD).join(NEW);
    const vector = (await embedTexts([content]))?.[0] ?? null;
    await db.update(kbChunks).set({ content, ...(vector ? { embedding: vector } : {}) }).where(eq(kbChunks.id, row.id));
    changed++;
    console.log(`  + ${row.id}${vector ? " re-embedded" : " (embedding unchanged)"}`);
  }
  console.log(changed ? `\n${changed} chunk(s) updated.` : "nothing to do");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
