/**
 * Production had no way to reserve a box, so no rental could ever be paid for.
 *
 * Reported 8 September: customers reach the summary, accept the terms, press
 * "Proceed to payment" -- and are told the box has just been taken. It had not
 * been. The audit trail for one of those conversations is six calls long and
 * Rental/Select is not among them:
 *
 *   Rental/Bundle           -> MyBox
 *   Rental/BoxLocations DXB -> 201 Dubai Central, 202 Union Square
 *   Rental/FreeBoxes    201 -> 41 boxes, including 2062
 *   Rental/Save             -> REFUSED LOCALLY: no hold on this case
 *   Rental/FreeBoxes    212 -> []            <- a branch that is not in the list
 *
 * Emirates Post records a rental against a hold created by Rental/Select. That
 * operation is `enabled: false` in the production environment, so buildApiTools
 * skips it (integrations.ts: `if (op.enabled === false) continue`) and the model
 * is never given the tool. It cannot reserve, so our own guard refuses every
 * Save -- correctly -- and the model, casting about for a reason, calls
 * FreeBoxes again against a location it has invented, gets an empty list, and
 * reports the box as taken. Payment is unreachable by construction.
 *
 * Two operations differ between staging and production, and they are exactly the
 * two that finish a rental:
 *
 *   post_api_Rental_Select                        the reservation
 *   post_api_Rental_UpdatePayment_paymentReferenceNo  the payment reference,
 *       without which even a settled payment is never recorded against it
 *
 * Idempotent, and it will not enable anything it was not asked to.
 *
 * Run from apps/web:
 *   npx tsx scripts/nxn-enable-rental-ops-2026-09-08.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");
const ENV_KEY = arg("--environment") ?? "production";
if (!ENV) throw new Error("--env <envfile> is required");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agentIntegrations, auditLog } from "@dialog/db";
import { eq } from "drizzle-orm";
import { auditOperationFlags } from "./lib/auditOps";

/** Only these. Everything else keeps whatever flag it has. */
const ENABLE = new Set(["post_api_Rental_Select", "post_api_Rental_UpdatePayment_paymentReferenceNo"]);

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agentIntegrations, auditLog } });
  try {
    const rows = await db.select().from(agentIntegrations);
    const changes: string[] = [];
    for (const row of rows) {
      if (!/nxn/i.test(row.name)) continue;
      const envs = JSON.parse(JSON.stringify(row.environments ?? {})) as Record<string, { operations?: Record<string, unknown>[] }>;
      const spec = envs[ENV_KEY];
      if (!spec?.operations) {
        console.log(`  ${row.name}: no "${ENV_KEY}" environment — skipped.`);
        continue;
      }
      let touched = false;
      for (const op of spec.operations) {
        const tool = String(op.toolName ?? "");
        if (!ENABLE.has(tool)) continue;
        if (op.enabled === false) {
          op.enabled = true;
          changes.push(`${row.name}/${ENV_KEY}: ${tool} enabled`);
          touched = true;
        } else {
          console.log(`  (already on) ${row.name}/${ENV_KEY}: ${tool}`);
        }
      }
      // Report anything we were asked to enable but could not find, rather than
      // succeeding quietly against an operation list that does not have it.
      for (const want of ENABLE) {
        if (!spec.operations.some((o) => String(o.toolName ?? "") === want)) {
          console.log(`  ! ${row.name}/${ENV_KEY}: ${want} is NOT in the operation list`);
        }
      }
      if (touched && APPLY) {
        await db.update(agentIntegrations).set({ environments: envs as never }).where(eq(agentIntegrations.id, row.id));
        // So the next person asking "who turned this on, and when" has an answer
        // in the database rather than in a commit message.
        await auditOperationFlags(db, {
          agentId: row.agentId ?? undefined,
          script: "nxn-enable-rental-ops-2026-09-08",
          integration: row.name,
          environment: ENV_KEY,
          enabled: [...ENABLE].filter((t) => changes.some((c) => c.includes(t))),
          note: "reservation and payment-reference operations were off, so no rental could be paid for",
        });
      }
    }
    if (!changes.length) {
      console.log("\nnothing to do — already enabled.");
      return;
    }
    console.log(`\n${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    console.log(APPLY ? "\nwritten." : "\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
