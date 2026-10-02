/**
 * `payments.provider` — the column the code was already writing (2026-10-02).
 *
 * UAEPay's first real payment on staging created its link, opened the checkout,
 * and then the turn died:
 *
 *   chat_stream_failed   at /node_modules/pg-pool/index.js:45:11
 *
 * Not UAEPay. The insert carried `provider`, which exists in the Drizzle schema
 * and did not exist in the database: the schema change shipped and the
 * migration never ran. The customer saw "Something went wrong on our side"
 * beside a perfectly good payment window.
 *
 * Nullable with no default and no backfill, deliberately. Every payment taken
 * before today went through the agent's single gateway, and NULL is exactly how
 * `gatewayForPayment` reads "the default binding" — so the old rows are already
 * correct and rewriting them would be writing a guess over a fact.
 *
 * Idempotent and safe to run on a live database: adding a nullable column takes
 * no table rewrite and no lock worth the name.
 *
 * Run from apps/web:
 *   npx tsx scripts/migrate-payments-provider-2026-10-02.ts --env <file> [--dry-run]
 */
import { databaseUrlFrom } from "./lib/envFile";
import pg from "pg";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
if (!ENV) throw new Error("--env <envfile> is required");
const DRY = process.argv.includes("--dry-run");

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  try {
    const { rows } = await pool.query(
      "select 1 from information_schema.columns where table_name = 'payments' and column_name = 'provider'"
    );
    if (rows.length) {
      console.log("  (already) payments.provider exists");
      console.log("\nAlready applied — nothing to change.");
      return;
    }
    console.log("  + payments.provider text (nullable, no backfill)");
    if (DRY) { console.log("\n--dry-run: NOT written."); return; }
    await pool.query("alter table payments add column if not exists provider text");
    console.log("\n1 change written.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
