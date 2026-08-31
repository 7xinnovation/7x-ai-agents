/**
 * The AED 25 courier fee was never ours to state (2026-08-31).
 *
 * It sat in the corporate knowledge base, and the model kept putting it on the
 * key-delivery card long after the journey text was corrected. Emirates Post
 * prices it at 30 for the bundles checked, it differs by bundle, and for MyHome
 * there is no key courier at all — the key comes with the box. The only place a
 * fee may come from is priceDetails on the Rental/Select response.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-kb-courier-fee-2026-08-31.ts [--env <file>]
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
const OLD = "Optional key delivery by courier costs AED 25, disclosed before the customer chooses between branch collection (free) and delivery.";
const NEW =
  "Optional key delivery by courier carries a fee that Emirates Post sets per bundle — it is not a fixed AED 25, and some bundles (MyHome, where the key comes with the box) do not offer it at all. The amount comes from the live system when the box is reserved and is shown before payment; the assistant never quotes a figure of its own.";

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!agent) throw new Error(`${SLUG} not found`);

  const rows = await db
    .select()
    .from(kbChunks)
    .where(and(eq(kbChunks.agentId, agent.id), like(kbChunks.content, "%AED 25%")));

  if (!rows.length) { console.log("nothing to do"); return; }

  for (const row of rows) {
    if (!row.content.includes(OLD)) { console.log(`  ! ${row.id} says AED 25 in wording this script does not know — check it by hand`); continue; }
    const content = row.content.split(OLD).join(NEW);
    // The chunk is retrieved by similarity, so the vector has to move with the text.
    const vector = (await embedTexts([content]))?.[0] ?? null;
    await db
      .update(kbChunks)
      .set({ content, ...(vector ? { embedding: vector } : {}) })
      .where(eq(kbChunks.id, row.id));
    console.log(`  + ${row.id} rewritten${vector ? " and re-embedded" : " (embedding unchanged — no embedding service)"}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
