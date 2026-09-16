/**
 * "What has been done" belongs to EPGL, not to a PO Box rental (2026-09-16).
 *
 * The customer-readable action log was built for EPGL — a licence application
 * commits the applicant to declarations and a payment, and the artefact asks
 * for a plain-language record of what was done in their name with the consent
 * beside each action. It was rendered for every agent, so the Emirates Post PO
 * Box widget grew a "What has been done" card too: renting a box does nothing
 * on anyone's behalf worth a ledger, and "Nothing has been done on your behalf
 * yet" answers a question nobody asked.
 *
 * The flag defaults to off, so this only has to turn it ON for EPGL. It is
 * reported honestly too: the readiness check for a customer-readable log now
 * fails for any agent whose panel does not carry one, rather than passing on
 * the renderer alone.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/activity-log-epgl-only-2026-09-16.ts [--env <file>] [--dry-run]
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

const WANT: Record<string, boolean> = {
  "epgl-dialog": true,
  "nxn-dialog": false,
  "collections-dialog": false,
};
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();
  let changes = 0;
  for (const [slug, want] of Object.entries(WANT)) {
    const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
    if (!row) { console.log(`  -    ${slug} not in this database`); continue; }
    const def = row.definition as { showActivityLog?: boolean };
    const had = def.showActivityLog ?? false;
    if (had === want) { console.log(`  ok   ${slug}: already ${want}`); continue; }
    console.log(`  set  ${slug}: ${had} -> ${want}`);
    changes++;
    if (dryRun) continue;
    def.showActivityLog = want;
    await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  }
  console.log(changes ? `\n${changes} change(s)${dryRun ? " (--dry-run, nothing written)" : " written"}` : "\nnothing to change");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
