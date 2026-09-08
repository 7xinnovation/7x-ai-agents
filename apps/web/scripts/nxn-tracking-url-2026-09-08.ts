/**
 * The tracking link we hand people was wrong.
 *
 * When someone asks the assistant about a shipment it says plainly that we do
 * not track parcels and points them at Emirates Post's own tracking page. It was
 * pointing at /track and /ar/track, which are not the pages. The real ones are:
 *
 *   https://www.emiratespost.ae/all-services/track-a-package
 *   https://www.emiratespost.ae/ar/all-services/track-a-package
 *
 * A wrong link is worse than no link here: the customer has already been told we
 * cannot help, and the one thing offered instead does not work either.
 *
 * Rewrites the URL wherever it appears in the agent definition — guidance,
 * persona, greeting, intents — rather than assuming it is only in the one place
 * nxn-no-tracking put it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-tracking-url-2026-09-08.ts --env <file> [--apply]
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

/** Old -> new, longest first so /ar/ is matched before the bare path. */
const REWRITES: [RegExp, string][] = [
  [/https:\/\/www\.emiratespost\.ae\/ar\/track(?![a-z-])/g, "https://www.emiratespost.ae/ar/all-services/track-a-package"],
  [/https:\/\/www\.emiratespost\.ae\/track(?![a-z-])/g, "https://www.emiratespost.ae/all-services/track-a-package"],
];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog"));
    if (!row) throw new Error("nxn-dialog not found in this database");
    const before = JSON.stringify(row.definition);
    let after = before;
    const counts: string[] = [];
    for (const [from, to] of REWRITES) {
      const n = (after.match(from) ?? []).length;
      if (n) counts.push(`${n}× ${to}`);
      after = after.replace(from, to);
    }
    if (after === before) {
      console.log("nothing to do — already correct.");
      return;
    }
    console.log(`${counts.length} rewrite(s):`);
    for (const c of counts) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: JSON.parse(after) }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else {
      console.log("\nDry run — nothing written. Add --apply to write.");
    }
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
