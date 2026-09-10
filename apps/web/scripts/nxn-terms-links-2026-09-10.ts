/**
 * The Terms a customer accepts have to be the Terms for what they are renting.
 *
 * Every journey linked to https://www.emiratespost.ae/en/terms-and-conditions —
 * one generic page for personal and corporate alike. Emirates Post gave us the
 * two real ones on 10 September:
 *
 *   personal   https://www.emiratespost.ae/terms-individual
 *   corporate  https://www.emiratespost.ae/terms-corporate
 *
 * This is the one link in the whole flow the customer is asked to ACCEPT, right
 * before paying, and their acceptance is timestamped and filed against the
 * rental. Pointing that at the wrong document is not a broken link.
 *
 * Both pages, and both /ar/ forms, answer 200 — checked the day this was
 * written. The Arabic swap is not here: it is in arabicLinks(), applied to the
 * finished reply, because the model reaches for whichever URL its guidance names
 * regardless of the language it is writing in.
 *
 * manage_po_box carries no terms link and is left alone: it covers personal and
 * corporate boxes both, so there is no right answer to write into it, and
 * nothing there asks for an acceptance.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-terms-links-2026-09-10.ts --env <file> [--apply]
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

const SLUG = "nxn-dialog";
const OLD = /https:\/\/www\.emiratespost\.ae\/(?:en\/)?terms-and-conditions/g;
const PERSONAL = "https://www.emiratespost.ae/terms-individual";
const CORPORATE = "https://www.emiratespost.ae/terms-corporate";

/** Which document a journey's customer is agreeing to. */
function termsFor(journeyKey: string): string | null {
  if (/^corporate_/.test(journeyKey)) return CORPORATE;
  if (/^personal_/.test(journeyKey)) return PERSONAL;
  return null;
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];

    for (const j of def.journeys ?? []) {
      const url = termsFor(String(j?.key ?? ""));
      if (!url) continue;
      const before = String(j.guidance ?? "");
      OLD.lastIndex = 0;
      const n = (before.match(OLD) || []).length;
      if (!n) continue;
      j.guidance = before.replace(OLD, url);
      changes.push(`${j.key}: ${n} link(s) -> ${url}`);
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
