/**
 * Invite an organisation to the developer portal.
 *
 * Creates (or reactivates) a developer account and prints the sign-in link.
 * Since 15 October 2026 there are no passwords: the person enters their email
 * on the sign-in page and receives a one-time code. Nothing secret is printed.
 *
 * From apps/web:
 *   npx tsx scripts/provision-developer-account-2026-10-14.ts --env <file> \
 *     --org "Prime Minister's Office" --name "PMO Technical Team" --email someone@example.gov.ae \
 *     --base https://<public host>
 */
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
  const pool = await poolFor(databaseUrlFromArgs());
  try {
    const { rows } = await pool.query(
      `insert into developer_accounts (organization, name, email, invited_by, active)
       values ($1, $2, $3, $4, true)
       on conflict (email) do update set organization = excluded.organization, name = excluded.name, active = true
       returning id, (xmax = 0) as created`,
      [org, name, email, "script:provision-developer-account-2026-10-14"]
    );
    const row = rows[0];
    await pool.query(`insert into audit_log (actor, action, payload) values ('system', $1, $2::jsonb)`, [
      row.created ? "developer_account_invited" : "developer_account_reinvited",
      JSON.stringify({ by: "script:provision-developer-account-2026-10-14", accountId: row.id, organization: org, email }),
    ]);
    console.log(`${row.created ? "Created" : "Reactivated"} ${email} (${org}) · account ${row.id}`);
    console.log(`Sign-in link (a one-time code is emailed when they ask for it):\n\n  ${base}/developers/login?email=${encodeURIComponent(email)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
