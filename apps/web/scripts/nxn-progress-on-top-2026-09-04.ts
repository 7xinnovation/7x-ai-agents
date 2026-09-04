/**
 * The readiness bar goes above the chat for Emirates Post, and nowhere else.
 *
 * They asked for it there — on a phone the case panel is a tab you have to leave
 * the conversation to see, so the one thing telling you how far through you are
 * was the one thing out of sight. It was applied to every agent, which moved
 * EPGL's out of the panel too, and EPGL never asked.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-progress-on-top-2026-09-04.ts [--env <file>] [--dry-run]
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

const DRY = process.argv.includes("--dry-run");
/** Only the agent that asked. Everything else keeps the panel it always had. */
const ON_TOP = new Set(["nxn-dialog"]);

async function main() {
  const db = getDb();
  const rows = await db.select().from(agents);
  let changed = 0;
  for (const row of rows) {
    const def = row.definition as unknown as Record<string, unknown>;
    const want = ON_TOP.has(row.slug) ? "top" : "panel";
    if (def.progressPlacement === want) { console.log(`  (already) ${row.slug}: ${want}`); continue; }
    def.progressPlacement = want;
    changed++;
    console.log(`  ~ ${row.slug}: ${want}`);
    if (!DRY) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  }
  console.log(changed ? (DRY ? `\n--dry-run: ${changed} not written.` : `\n${changed} written.`) : "\nnothing to do.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
