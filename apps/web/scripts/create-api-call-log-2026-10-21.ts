/**
 * `api_calls` — the endpoint audit log behind the admin's API Logs page.
 *
 * Asked for on 21 October: "an audit log of endpoints being called to show
 * which ones are successful and ones that are failing ... separate for both
 * agents." One row per outbound call from `executeOperation`.
 *
 * Explicit DDL, not `drizzle-kit push`, for the reason recorded in
 * create-blocklist-tables-2026-09-15.ts: push reconciles the whole schema and
 * on staging offered to truncate live payment rows. Mirrors
 * packages/db/src/schema.ts; index names match the Drizzle definitions.
 * Idempotent.
 *
 * Run from apps/web, dry run first:
 *   npx tsx scripts/create-api-call-log-2026-10-21.ts --env <file>
 *   npx tsx scripts/create-api-call-log-2026-10-21.ts --env <file> --apply
 */
import { databaseUrlFromArgs } from "./lib/envFile";
import { poolFor } from "./lib/pgPool";

const APPLY = process.argv.includes("--apply");

export const DDL = [
  `CREATE TABLE IF NOT EXISTS api_calls (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     agent_id uuid,
     conversation_id uuid,
     integration text,
     environment text,
     tool text,
     method text NOT NULL,
     path text NOT NULL,
     url text NOT NULL,
     status integer,
     ok boolean NOT NULL,
     duration_ms integer NOT NULL,
     error text,
     request_body text,
     response_body text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS api_calls_agent_created_idx ON api_calls (agent_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS api_calls_agent_ok_idx ON api_calls (agent_id, ok)`,
];

const TABLES = ["api_calls"];

async function main() {
  const pool = await poolFor(databaseUrlFromArgs());
  try {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [TABLES]
    );
    const have = new Set(rows.map((r) => r.table_name as string));
    for (const t of TABLES) console.log(`${have.has(t) ? "exists " : "missing"} ${t}`);
    if (!APPLY) {
      console.log(`\nDry run. ${DDL.length} statements would run. Add --apply to create what is missing.`);
      return;
    }
    for (const stmt of DDL) {
      await pool.query(stmt);
      console.log(`ok  ${stmt.trim().split("\n")[0]!.slice(0, 90)}`);
    }
    console.log("\nApplied.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
