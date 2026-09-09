/**
 * The enquiry link on production pointed at STAGING.
 *
 * When the assistant cannot answer something in Phase 1's scope it offers
 * "raise an enquiry" — and on production that link went to
 * www-stg.emiratespost.ae, which is password-protected. A customer already told
 * we cannot help then met a browser auth prompt. Reported 9 September; the
 * staging URL is in BOTH environments, so it has never worked for anyone.
 *
 * Checked before writing: www.emiratespost.ae/contact-us/raise-an-enquiry and
 * its /ar/ counterpart both return 200; the www-stg one returns 401.
 *
 * Also gives the Arabic conversation the Arabic page, which it never had.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-enquiry-url-2026-09-09.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");
if (!ENV) throw new Error("--env <envfile> is required");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const STAGING = /https:\/\/www-stg\.emiratespost\.ae\/contact-us\/raise-an-enquiry/g;
const LIVE = "https://www.emiratespost.ae/contact-us/raise-an-enquiry";

const MARKER = "THE ENQUIRY LINK (2026-09-09)";
const RULE =
  ` ${MARKER}: when you offer to raise an enquiry, the link is ${LIVE} in English and https://www.emiratespost.ae/ar/contact-us/raise-an-enquiry in Arabic.` +
  ` Use the Arabic one whenever the conversation is in Arabic. Never link to www-stg.emiratespost.ae — it is a protected staging site and asks the customer for a password they do not have.`;

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog"));
    if (!row) throw new Error("nxn-dialog not found");
    const before = JSON.stringify(row.definition);
    const n = (before.match(STAGING) ?? []).length;
    let after = before.replace(STAGING, LIVE);
    const def = JSON.parse(after) as Record<string, any>;
    const changes: string[] = [];
    if (n) changes.push(`${n}× staging enquiry URL -> ${LIVE}`);
    for (const j of def.journeys ?? []) {
      if (!String(j.guidance ?? "").includes(MARKER)) {
        j.guidance = String(j.guidance ?? "") + RULE;
        changes.push(`${j.key}.guidance += enquiry link rule`);
      }
    }
    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else console.log("\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
