/**
 * Remove the production merchant id from a STAGING payment binding (2026-09-04).
 *
 * `200200012694` is EPGL's production merchant id and it was recorded in the
 * staging binding for reference. It is inert -- the N-Genius adapter reads only
 * baseUrl, outletRef and the API key, and posts to
 * {baseUrl}/transactions/outlets/{outletRef}/orders -- but a production
 * identifier sitting in a staging config is a question someone has to answer
 * every time they look at it, and the answer is only reassuring if you go and
 * read the adapter. Emre asked twice. Better gone.
 *
 * REFUSES to touch a production deployment: there the merchant id belongs.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/strip-staging-merchant-id-2026-09-04.ts [--env <file>] [--dry-run]
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

async function main() {
  const db = getDb();
  const rows = await db.select().from(agents);
  let changed = 0;

  for (const row of rows) {
    const def = row.definition as unknown as Record<string, any>;
    const pay = def.integrations?.payment;
    const merchantId = pay?.settings?.merchantId;
    if (!merchantId) continue;

    const base = String(pay.settings.baseUrl ?? "");
    const isSandbox = /sandbox/i.test(base);
    if (!isSandbox) {
      console.log(`  (keep) ${row.slug}: LIVE gateway — merchantId ${merchantId} belongs here`);
      continue;
    }

    console.log(`  - ${row.slug}: removing merchantId ${merchantId} from the sandbox binding`);
    delete pay.settings.merchantId;
    changed++;
    if (!DRY) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  }

  if (!changed) { console.log("\nnothing to do."); return; }
  console.log(DRY ? `\n--dry-run: ${changed} change(s) not written.` : `\n${changed} change(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
