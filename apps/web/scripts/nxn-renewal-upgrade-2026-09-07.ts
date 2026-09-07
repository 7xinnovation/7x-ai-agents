/**
 * The renewal offers the upgrade (2026-09-07), from Emirates Post's review.
 *
 * Renewing is the moment a customer is already thinking about their box, and it
 * is the moment their own portal offers a better one. Ours did not: a MyHome
 * customer renewing for ten years was never told MyHome Instant existed.
 *
 * Their backend has always supported it — Renewal/Details returns the bundles
 * available on this renewal, and Renewal/Pricing takes newBundleId with
 * isBundleChanged. The tool result now names the upgrades outright (see
 * lib/integrations); this is the half of it the model needs before the call,
 * so it knows to look rather than to skip past.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-renewal-upgrade-2026-09-07.ts [--env <file>] [--dry-run]
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
const DRY = process.argv.includes("--dry-run");
const MARKER = "A RENEWAL IS ALSO A CHANCE TO UPGRADE";

const TEXT =
  `${MARKER}. Emirates Post offers a better bundle at renewal, and the renewal details response lists exactly ` +
  "which ones are available for this box — read it before you present anything. If it names a bundle above the " +
  "one they are on, offer it as a plain choice beside renewing where they are: one line each, with the price, " +
  "and let them pick. A MyHome customer is offered MyHome Instant this way.\n\n" +
  "Say it ONCE, when you first show the renewal. Do not talk them into it, do not pre-select it, do not repeat " +
  "the offer after they have chosen, and never present it as something they must decide before renewing. If they " +
  "stay where they are, that is the ordinary answer and needs no comment.\n\n" +
  "If they take it, price it: call renewal pricing again with newBundleId set to that bundle's id from the list " +
  "and isBundleChanged true, and use the total that comes back. NEVER show the upgrade at the old bundle's price, " +
  "and never work out an upgrade price yourself — a renewal is priced by Emirates Post for the term and the " +
  "bundle together, and the difference is not the difference between two annual rates.\n\n" +
  "A renewal can go UP or stay where it is. It cannot go down: if they ask for a cheaper bundle, say plainly that " +
  "a renewal keeps or upgrades their bundle and that moving to a lower one is done with Emirates Post directly.";

interface Journey { key: string; guidance?: string }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys?: Journey[] };
  let changed = 0;

  for (const j of def.journeys ?? []) {
    if (!/renewal/.test(j.key)) continue;
    const had = (j.guidance ?? "").includes(MARKER);
    // Replace the block rather than appending a second copy: the marker is the
    // identity, so a re-run after an edit updates what is there.
    const without = (j.guidance ?? "")
      .split(/\n{2,}/)
      .filter((p) => !p.includes(MARKER))
      .join("\n\n")
      .trim();
    const next = `${without}\n\n${TEXT}`.trim();
    if (next === j.guidance) { console.log(`  (already) ${j.key}`); continue; }
    j.guidance = next;
    changed++;
    console.log(`  ~ ${j.key}: ${had ? "replaced" : "added"} (${next.length} chars)`);
  }

  if (changed && !DRY) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(changed ? (DRY ? `\n--dry-run: ${changed} not written.` : `\n${changed} written.`) : "\nnothing to do.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
