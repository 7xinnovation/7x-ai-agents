/**
 * Copy the admin-console accounts from one environment to another.
 *
 * These are OPERATOR logins (the people who administer agents), not customers —
 * the customer-facing tables were deliberately left behind when prod was seeded,
 * because they were full of QA traffic.
 *
 * Password hashes travel as-is. They are bcrypt, salted per row and independent of
 * SECRETS_KEY, so they keep working in the target environment — unlike the
 * integration secrets, which are encrypted with the environment's key and broke
 * precisely because that was not true of them.
 *
 * Existing rows are matched on email and left alone: this never overwrites a
 * password someone has already rotated in the target environment.
 *
 * Run from apps/web:
 *   npx tsx scripts/seed-users-from-staging.ts --from <src.env> --to <dst.env> [--dry-run]
 */
import { databaseUrlFrom } from "./lib/envFile";
import { Pool } from "pg";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");

/** Read DATABASE_URL out of an env file without disturbing process.env. */
const dbUrl = databaseUrlFrom;

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  role: string;
  provider: string;
  active: boolean;
}

async function main() {
  const from = arg("--from");
  const to = arg("--to");
  if (!from || !to) throw new Error("usage: --from <src.env> --to <dst.env> [--dry-run]");
  const src = new Pool({ connectionString: dbUrl(from) });
  const dst = new Pool({ connectionString: dbUrl(to) });

  const { rows: source } = await src.query<UserRow>(
    "select id, email, name, password_hash, role, provider, active from users order by created_at"
  );
  const { rows: existing } = await dst.query<{ email: string }>("select email from users");
  const have = new Set(existing.map((r) => r.email.toLowerCase()));

  console.log(`source users: ${source.length}, target already has: ${have.size}\n`);

  let inserted = 0;
  for (const u of source) {
    const masked = `${u.email.slice(0, 3)}***`;
    if (have.has(u.email.toLowerCase())) {
      console.log(`  (skip) ${masked.padEnd(10)} ${u.role.padEnd(7)} already present`);
      continue;
    }
    if (!dryRun) {
      // Keep the same id so anything referencing a user id lines up across
      // environments; ON CONFLICT covers a concurrent insert.
      await dst.query(
        `insert into users (id, email, name, password_hash, role, provider, active)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (email) do nothing`,
        [u.id, u.email, u.name, u.password_hash, u.role, u.provider, u.active]
      );
    }
    inserted++;
    console.log(`  ${dryRun ? "would add" : "     +   "} ${masked.padEnd(10)} ${u.role.padEnd(7)} ${u.password_hash ? "with password" : "NO PASSWORD"}`);
  }

  const { rows: after } = await dst.query<{ n: string }>("select count(*)::text n from users");
  console.log(`\n${dryRun ? "(dry run) " : ""}target now has ${dryRun ? Number(after[0]!.n) + inserted : after[0]!.n} users.`);
  await src.end();
  await dst.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
