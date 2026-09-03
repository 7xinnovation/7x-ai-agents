/**
 * EPGL licensing enhancements (2026-09-03), from the client's list.
 *
 * 1. SIGN-IN REQUIRED for a new licence and for a renewal, as Emirates Post
 *    already requires for a new PO Box rental. Journey.requiresAuth defaults to
 *    true in the schema, so if these are running open the stored definition sets
 *    it false explicitly -- this reports what it found rather than assuming.
 *
 * 2. THE TWO RENEWAL CONFIRMATIONS, in the client's own words. A plain renewal
 *    and a renewal where the customer has changed their trade licence details
 *    end differently: the first issues within a working day, the second goes to
 *    the Licensing team for a call. The model must not paraphrase either -- the
 *    penalties sentence in particular is a financial statement.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-enhancements-2026-09-03.ts [--env <file>] [--dry-run]
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
const GATED = ["new_license", "renewal"];

const MARKER = "RENEWAL CONFIRMATION WORDING";

/** Verbatim. Quoted here so a future edit is visibly an edit. */
const RENEWAL_WORDING =
  `${MARKER} — send ONE of these two, WORD FOR WORD, as the confirmation after a renewal is submitted. ` +
  "Do not paraphrase, shorten, translate loosely or merge them, and do not add a reference number sentence of your own before them. " +
  "\n\nIf the customer renewed WITHOUT changing any trade licence detail:\n" +
  '"Thank you for your confirmation and payment. Your transaction has been received and your new license should be issued within one working day and will be available on your workspace when ready.\n' +
  'Any pending penalties, fines or late fees will be automatically deducted from your payment."\n' +
  "\nIf the customer CHANGED any trade licence detail during the renewal (company name, trade name, regulator, address, partners, or any other licence field):\n" +
  '"Dear client,\nAs you have made changes to your trade license, a request has been submitted to the Licensing team and you will be contacted within one working day to update information requested."\n' +
  "\nThe second replaces the first — a renewal with changes is NOT issued within a working day, so never send both and never promise issuance when details changed. " +
  "In Arabic, translate faithfully and keep both as single confirmations.";

interface Journey { key: string; requiresAuth?: boolean; guidance?: string; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    if (!GATED.includes(j.key)) continue;
    if (j.requiresAuth === true) {
      console.log(`  (already) ${j.key}: sign-in required`);
    } else {
      console.log(`  + ${j.key}: requiresAuth ${String(j.requiresAuth)} -> true`);
      j.requiresAuth = true;
      changed++;
    }
    if (j.key === "renewal") {
      const g = String(j.guidance ?? "");
      if (g.includes(MARKER)) {
        console.log("  (already) renewal: confirmation wording present");
      } else {
        j.guidance = g ? `${g}\n\n${RENEWAL_WORDING}` : RENEWAL_WORDING;
        changed++;
        console.log("  + renewal: confirmation wording added");
      }
    }
  }

  const missing = GATED.filter((k) => !def.journeys.some((j) => j.key === k));
  if (missing.length) throw new Error(`journeys not found on ${SLUG}: ${missing.join(", ")}`);
  if (!changed) { console.log("\nnothing to do."); return; }
  if (DRY) { console.log(`\n--dry-run: ${changed} change(s) not written.`); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} change(s) written.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
