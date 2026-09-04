/**
 * Strip the 1% fee from EPGL's stored journey guidance (2026-09-04).
 *
 * The fee was removed from the CONFIGURATION -- 150,000 flat, no percentage --
 * but the guidance stored on the journeys still described it. Two of the
 * sentences came from an older revision of the payment block, so re-running that
 * script did not touch them: it strips the paragraphs it wrote, and these were
 * written by a version of it that no longer exists.
 *
 * Left alone, the assistant would announce a 1% admin processing fee, quote a
 * total including it, and the customer would be charged 150,000 -- a discrepancy
 * in the customer's favour, which is still telling them something untrue about
 * their own payment.
 *
 * Sentence-level rather than paragraph-level, because the fee is mentioned
 * mid-paragraph in guidance that is otherwise correct and worth keeping.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-drop-fee-wording-2026-09-04.ts [--env <file>] [--dry-run]
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

const SLUG = "epgl-dialog";
const DRY = process.argv.includes("--dry-run");
const JOURNEYS = ["new_license", "renewal"];

/** A sentence naming the fee is dropped; everything else is kept verbatim. */
const MENTIONS_FEE = /1\s*%|admin(istrative)?\s+processing\s+fee|processing\s+fees/i;

export function stripFeeSentences(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!MENTIONS_FEE.test(line)) return line;
      // Split on sentence ends, keeping the delimiter, so only the offending
      // sentence goes and the rest of the line survives intact.
      const parts = line.split(/(?<=[.!?])\s+/);
      const kept = parts.filter((p) => !MENTIONS_FEE.test(p));
      return kept.join(" ").replace(/\s{2,}/g, " ").trim();
    })
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n")
    .trim();
}

interface Journey { key: string; guidance?: string }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    if (!JOURNEYS.includes(j.key)) continue;
    const before = String(j.guidance ?? "");
    if (!MENTIONS_FEE.test(before)) { console.log(`  (already) ${j.key}: no fee wording`); continue; }
    const after = stripFeeSentences(before);
    j.guidance = after;
    changed++;
    console.log(`  + ${j.key}: ${before.length} -> ${after.length} chars`);
  }

  if (!changed) { console.log("\nnothing to do."); return; }
  if (DRY) { console.log(`\n--dry-run: ${changed} change(s) not written.`); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} change(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
