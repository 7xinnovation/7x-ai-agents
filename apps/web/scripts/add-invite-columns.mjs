/**
 * The invitation columns. Idempotent, and the same shape the schema declares.
 * Nothing existing changes: an account with a password is unaffected by all
 * three being null.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
const c = new pg.Client({ connectionString: /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(process.argv[2], "utf8"))[1] });
await c.connect();
await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token_hash text`);
await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz`);
await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by text`);
await c.query(`CREATE INDEX IF NOT EXISTS users_invite_token_idx ON users (invite_token_hash)`);
const r = await c.query(
  `SELECT email, role, active, password_hash is null as no_password, invite_token_hash is not null as invited
     FROM users ORDER BY created_at`
);
console.log(process.argv[2].split("/").pop());
for (const u of r.rows) console.log(`  ${u.email.padEnd(28)} ${u.role.padEnd(7)} ${u.no_password ? "no password" : "has password"}${u.invited ? " · INVITED" : ""}`);
await c.end();
