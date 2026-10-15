/**
 * Invite an organisation to the developer portal.
 *
 * Creates (or re-invites) a developer account and prints the one-time invite
 * link. The person opens it, sets their own password, and creates their
 * applications; we never hold their password. The link is good for seven days
 * and for one use. Only the token's SHA-256 is stored.
 *
 * From apps/web:
 *   npx tsx scripts/provision-developer-account-2026-10-14.ts --env <file> \
 *     --org "Prime Minister's Office" --name "PMO Technical Team" --email someone@example.gov.ae \
 *     --base https://<public host>
 */
import { randomBytes, createHash } from "node:crypto";
import { databaseUrlFromArgs } from "./lib/envFile";
import { poolFor } from "./lib/pgPool";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const org = arg("--org");
  const name = arg("--name");
  const email = arg("--email")?.trim().toLowerCase();
  const base = (arg("--base") ?? "http://localhost:3000").replace(/\/$/, "");
  if (!org || !name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error("usage: --env <file> --org <organisation> --name <contact name> --email <email> [--base <public origin>]");
    process.exit(2);
  }
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pool = await poolFor(databaseUrlFromArgs());
  try {
    const { rows } = await pool.query(
      `insert into developer_accounts (organization, name, email, invite_token_hash, invite_expires_at, invited_by, active)
       values ($1, $2, $3, $4, $5, $6, true)
       on conflict (email) do update set organization = excluded.organization, name = excluded.name,
         invite_token_hash = excluded.invite_token_hash, invite_expires_at = excluded.invite_expires_at, active = true
       returning id, (xmax = 0) as created`,
      [org, name, email, hash, expiresAt, "script:provision-developer-account-2026-10-14"]
    );
    const row = rows[0];
    await pool.query(`insert into audit_log (actor, action, payload) values ('system', $1, $2::jsonb)`, [
      row.created ? "developer_account_invited" : "developer_account_reinvited",
      JSON.stringify({ by: "script:provision-developer-account-2026-10-14", accountId: row.id, organization: org, email }),
    ]);
    console.log(`${row.created ? "Created" : "Re-invited"} ${email} (${org}) · account ${row.id}`);
    console.log(`Invite link (one use, expires ${expiresAt.toISOString()}):\n\n  ${base}/developers/invite/${token}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
