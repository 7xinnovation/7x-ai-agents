/**
 * The two tables behind the blocked-company list.
 *
 * Written as explicit DDL rather than `drizzle-kit push` on purpose. Push
 * compares the WHOLE schema against the database and offers to reconcile
 * everything it finds drifted — on staging it opened by proposing a unique
 * constraint on `payments` and asking whether to truncate 176 live payment
 * rows. Adding two new tables should not put that question on the screen.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS). Run from apps/web:
 *   npx tsx scripts/create-blocklist-tables-2026-09-15.ts --env <file> [--apply]
 */
import { databaseUrlFromArgs } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");

import pg from "pg";

const DDL = [
  `CREATE TABLE IF NOT EXISTS blocked_company_batches (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
     file_name text NOT NULL,
     row_count integer NOT NULL,
     skipped_count integer NOT NULL DEFAULT 0,
     uploaded_by text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS blocked_batches_agent_idx ON blocked_company_batches (agent_id)`,
  `CREATE TABLE IF NOT EXISTS blocked_companies (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
     batch_id uuid NOT NULL,
     trade_license_key text,
     postal_license_key text,
     company_name_key text,
     trade_license_number text,
     postal_license_number text,
     company_name text,
     reason text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS blocked_companies_agent_idx ON blocked_companies (agent_id)`,
  `CREATE INDEX IF NOT EXISTS blocked_companies_trade_idx ON blocked_companies (agent_id, trade_license_key)`,
  `CREATE INDEX IF NOT EXISTS blocked_companies_postal_idx ON blocked_companies (agent_id, postal_license_key)`,
  `CREATE INDEX IF NOT EXISTS blocked_companies_name_idx ON blocked_companies (agent_id, company_name_key)`,
];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFromArgs() });
  try {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('blocked_companies','blocked_company_batches')`
    );
    const have = new Set(rows.map((r) => r.table_name as string));
    console.log(`already present: ${have.size ? [...have].join(", ") : "neither"}`);
    if (!APPLY) {
      console.log(`\nDry run — nothing written. ${DDL.length} statement(s) would run. Add --apply.`);
      return;
    }
    for (const sql of DDL) {
      await pool.query(sql);
      console.log(`  ok  ${sql.split("\n")[0]!.trim().slice(0, 78)}`);
    }
    const after = await pool.query(
      `SELECT table_name, (SELECT count(*) FROM blocked_companies) AS companies
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('blocked_companies','blocked_company_batches')`
    );
    console.log(`\nwritten. tables now: ${after.rows.map((r) => r.table_name).join(", ")}; rows: ${after.rows[0]?.companies ?? 0}`);
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
