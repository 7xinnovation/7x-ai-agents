/**
 * "Can it not fetch all the details based on the trade licence?"
 *
 * It can, and it does: the company, the postal licence, the emirate, the
 * regulator, the status and the expiry all come back from EPGL's own record off
 * the trade licence number, and none of it is retyped. What follows a second
 * later is a request to upload the trade licence — which, with the details
 * already on screen, reads as the assistant having forgotten what it just
 * showed.
 *
 * It has not. The DOCUMENT is a separate requirement from the DATA: EPGL's
 * reviewers verify the renewal against the licence itself, and the copy behind
 * their record is the one that is expiring — PINCHAIN's trade licence expired on
 * 18-08-2026, which is the reason the renewal exists.
 *
 * So the ask is right and the silence around it is not. One clause, so the
 * assistant says why it still needs the document when it has just displayed the
 * details, and so it never implies the lookup failed.
 *
 * Idempotent. Run from apps/web, against an env file or an inherited
 * DATABASE_URL:
 *   npx tsx scripts/epgl-renewal-why-the-licence-2026-09-16.ts [--env <file>] [--apply]
 */
import { databaseUrlFromArgs } from "./lib/envFile";

const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const MARKER = "WHY THE LICENCE IS STILL ASKED FOR (2026-09-16)";

const CLAUSE =
  ` ${MARKER}: when you have just shown the company's details from EPGL's record and then ask for the trade licence document, SAY WHY in the same breath — ` +
  "one short clause, not a paragraph: you have the details from EPGL's file, and the document itself is what their reviewers check the renewal against, because the licence on file is the one that is expiring. " +
  "Never let it read as though the lookup failed or as though you have forgotten what you just displayed. " +
  "If the customer has ALREADY uploaded the trade licence to identify the company, that IS this document — do not ask for it a second time.";

function guidanceOf(j: Record<string, any>): string {
  const g = j.guidance;
  return typeof g === "string" ? g : String(g?.en ?? "");
}
function setGuidance(j: Record<string, any>, text: string) {
  if (typeof j.guidance === "string") j.guidance = text;
  else j.guidance = { ...j.guidance, en: text };
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFromArgs() });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];
    for (const j of def.journeys ?? []) {
      if (j.key !== "renewal") continue;
      const g = guidanceOf(j);
      if (g.includes(MARKER)) continue;
      setGuidance(j, `${g.trimEnd()}\n${CLAUSE.trim()}`);
      changes.push("renewal: + why the licence is still asked for");
    }
    if (!changes.length) { console.log("nothing to do — already applied."); return; }
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
