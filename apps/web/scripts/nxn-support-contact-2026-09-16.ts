/**
 * The number belongs to the entity that answers it.
 *
 * Emirates Post's 600 599 999 was hardcoded into both places the assistant tells
 * a customer to reach a person — so when an EPGL renewal failed to submit on
 * 16 September, the applicant was sent to the PO Box helpline about a postal
 * activity licence. Whoever answers there cannot help with it.
 *
 * The number is now a property of the agent (definition.supportContact). This
 * puts Emirates Post's back where it belongs and deliberately leaves EPGL's
 * unset: they have not given us one, and inventing a contact route for a
 * government service is worse than saying we do not have it.
 *
 * Idempotent. Run from apps/web, against an env file or an inherited
 * DATABASE_URL:
 *   npx tsx scripts/nxn-support-contact-2026-09-16.ts [--env <file>] [--apply]
 */
import { databaseUrlFromArgs } from "./lib/envFile";

const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

/** Only where the number is actually theirs. */
const CONTACTS: Record<string, string> = {
  "nxn-dialog": "600 599 999",
};

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFromArgs() });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const changes: string[] = [];
    for (const [slug, contact] of Object.entries(CONTACTS)) {
      const [row] = await db.select().from(agents).where(eq(agents.slug, slug));
      if (!row) { console.log(`   ! ${slug} not in this database, skipped`); continue; }
      const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
      if (def.supportContact === contact) continue;
      def.supportContact = contact;
      changes.push(`${slug}.supportContact = ${contact}`);
      if (APPLY) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
    }
    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    for (const c of changes) console.log(`   ~ ${c}`);
    console.log(APPLY ? "\nwritten." : "\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
