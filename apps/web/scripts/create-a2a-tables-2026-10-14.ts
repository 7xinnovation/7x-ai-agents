/**
 * The four tables behind the developer portal and the A2A task doorway:
 * developer_accounts, developer_apps, a2a_tasks, a2a_requests.
 *
 * Explicit DDL, not `drizzle-kit push`, for the reason recorded in
 * create-blocklist-tables-2026-09-15.ts: push reconciles the whole schema and
 * on staging offered to truncate live payment rows. Mirrors packages/db/src/schema.ts;
 * index names match the Drizzle definitions. Idempotent.
 *
 * Run from apps/web, dry run first:
 *   npx tsx scripts/create-a2a-tables-2026-10-14.ts --env <file>
 *   npx tsx scripts/create-a2a-tables-2026-10-14.ts --env <file> --apply
 */
import { databaseUrlFromArgs } from "./lib/envFile";
import { poolFor } from "./lib/pgPool";

const APPLY = process.argv.includes("--apply");

export const DDL = [
  `CREATE TABLE IF NOT EXISTS developer_accounts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     organization text NOT NULL,
     name text NOT NULL,
     email text NOT NULL UNIQUE,
     password_hash text,
     active boolean NOT NULL DEFAULT true,
     invite_token_hash text,
     invite_expires_at timestamptz,
     invited_by text,
     last_login_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS developer_accounts_email_idx ON developer_accounts (email)`,
  `CREATE INDEX IF NOT EXISTS developer_accounts_invite_idx ON developer_accounts (invite_token_hash)`,
  `CREATE TABLE IF NOT EXISTS developer_apps (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id uuid NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
     name text NOT NULL,
     client_id text NOT NULL UNIQUE,
     client_secret_hash text NOT NULL,
     api_key_hash text NOT NULL UNIQUE,
     api_key_hint text NOT NULL,
     agent_slugs jsonb NOT NULL DEFAULT '[]'::jsonb,
     scopes jsonb NOT NULL DEFAULT '["tasks"]'::jsonb,
     revoked_at timestamptz,
     rotated_at timestamptz,
     last_used_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS developer_apps_account_idx ON developer_apps (account_id)`,
  `CREATE INDEX IF NOT EXISTS developer_apps_client_idx ON developer_apps (client_id)`,
  `CREATE INDEX IF NOT EXISTS developer_apps_key_idx ON developer_apps (api_key_hash)`,
  `CREATE TABLE IF NOT EXISTS a2a_tasks (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     agent_id uuid NOT NULL,
     agent_slug text NOT NULL,
     app_id uuid NOT NULL REFERENCES developer_apps(id) ON DELETE CASCADE,
     conversation_id uuid NOT NULL,
     case_id uuid,
     state text NOT NULL,
     status jsonb NOT NULL,
     artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
     history jsonb NOT NULL DEFAULT '[]'::jsonb,
     metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
     awaiting text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS a2a_tasks_app_updated_idx ON a2a_tasks (app_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS a2a_tasks_conversation_idx ON a2a_tasks (conversation_id)`,
  `CREATE TABLE IF NOT EXISTS a2a_requests (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     app_id uuid REFERENCES developer_apps(id) ON DELETE CASCADE,
     agent_slug text,
     task_id uuid,
     method text NOT NULL,
     binding text NOT NULL,
     ok boolean NOT NULL,
     error_code integer,
     http_status integer NOT NULL,
     latency_ms integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS a2a_requests_app_created_idx ON a2a_requests (app_id, created_at)`,
  // Sign-in by one-time code (2026-10-15).
  `ALTER TABLE developer_accounts ADD COLUMN IF NOT EXISTS otp_hash text`,
  `ALTER TABLE developer_accounts ADD COLUMN IF NOT EXISTS otp_expires_at timestamptz`,
  `ALTER TABLE developer_accounts ADD COLUMN IF NOT EXISTS otp_attempts integer NOT NULL DEFAULT 0`,
  `ALTER TABLE developer_accounts ADD COLUMN IF NOT EXISTS otp_sent_at timestamptz`,
  // Super admin and settings (2026-10-15).
  `ALTER TABLE developer_accounts ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'developer'`,
  `CREATE TABLE IF NOT EXISTS portal_settings (
     key text PRIMARY KEY,
     value jsonb NOT NULL,
     updated_by text,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS audit_action_created_idx ON audit_log (action, created_at)`,
];

const TABLES = ["developer_accounts", "developer_apps", "a2a_tasks", "a2a_requests", "portal_settings"];

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
