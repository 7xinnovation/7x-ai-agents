/**
 * EPGL stops showing where its answers came from (2026-10-20).
 *
 * Reported on the licensing agent: an eligibility answer ended in four chips
 * reading "EPGL Licensing Guide §1", "§2", "§3", "§7". Those section numbers
 * are ours. They name a document the applicant has never seen and cannot open,
 * so under a paragraph they had already understood sits a citation to nothing.
 *
 * `showSources` defaults to TRUE, so this only has to turn it OFF for EPGL —
 * NXN keeps its sources, where the guide is Emirates Post's own published one.
 * Nothing stops being retrieved and nothing stops being recorded: the citations
 * still reach the transcript and the admin conversation view, they are simply
 * not shown to the customer.
 *
 * Per environment, like every definition change — run it on staging AND on
 * production. Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-hide-sources-2026-10-20.ts [--env <file>] [--dry-run]
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

/** Only EPGL was asked for. An agent nobody has complained about is left alone. */
const WANT: Record<string, boolean> = {
  "epgl-dialog": false,
};
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();
  let changes = 0;
  for (const [slug, want] of Object.entries(WANT)) {
    const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
    if (!row) { console.log(`  -    ${slug} not in this database`); continue; }
    const def = row.definition as { showSources?: boolean };
    const had = def.showSources ?? true;
    if (had === want) { console.log(`  ok   ${slug}: already ${want}`); continue; }
    console.log(`  set  ${slug}: ${had} -> ${want}`);
    changes++;
    if (dryRun) continue;
    def.showSources = want;
    await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  }
  console.log(changes ? `\n${changes} change(s)${dryRun ? " (--dry-run, nothing written)" : " written"}` : "\nnothing to change");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
