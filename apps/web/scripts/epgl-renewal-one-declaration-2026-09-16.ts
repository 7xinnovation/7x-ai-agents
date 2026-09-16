/**
 * A renewal asks for one acknowledgement, not four.
 *
 * The renewal ended with four checkboxes: the Declaration & Undertaking, EPGL's
 * postal licensing terms, "the approved commitment form", and "the mandatory
 * integration with IDEP". Reported 16 September — the bottom three are not
 * needed on a renewal and mean nothing to the customer, who is being asked to
 * accept an internal integration and a form they have never seen.
 *
 * They were also a wall at the last step of a long journey: four boxes, each one
 * a chance to stall, on an application that is otherwise finished. The new
 * licence has always asked for the one that matters and nothing else.
 *
 * Safe to remove. The payment gate keys off a journey DECLARING terms_accepted
 * (tools.ts), so dropping the field drops the gate with it, and the recorded
 * approval before a charge is the declaration — which route.ts and the readiness
 * check both already accept in its place.
 *
 * And while in here: the guidance still called the Audited Financial Statements
 * MANDATORY, which EPGL's licensing team corrected the same day.
 *
 * Idempotent. Run from apps/web, against an env file or an inherited
 * DATABASE_URL:
 *   npx tsx scripts/epgl-renewal-one-declaration-2026-09-16.ts [--env <file>] [--apply]
 */
import { databaseUrlFromArgs } from "./lib/envFile";

const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const MARKER = "ONE ACKNOWLEDGEMENT ON A RENEWAL (2026-09-16)";

/** The three the renewal should never have carried, and their timestamps. */
const DROP = new Set([
  "terms_accepted",
  "terms_accepted_at",
  "commitment_form_accepted",
  "commitment_form_accepted_at",
  "idep_integration_accepted",
  "idep_integration_accepted_at",
]);

const CLAUSE =
  ` ${MARKER}: a RENEWAL has exactly ONE acknowledgement — the Declaration & Undertaking. ` +
  "Present it as a single in-chat checkbox and nothing else: no terms and conditions box, no commitment form, no IDEP integration box. " +
  "Those were removed because they do not apply to a renewal and mean nothing to the customer. Never reintroduce them, and never ask the customer to accept something this journey does not record.";

/** The line the licensing team corrected on 16 September. */
const AFS_WAS = "the Audited Financial Statements are MANDATORY";
const AFS_NOW =
  "the Audited Financial Statements are REQUESTED BUT NOT REQUIRED — a courier may renew without them, the application is then recorded as partially completed, and they have six months to send them or an audit acknowledgement letter instead";

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
      for (const s of j.steps ?? []) {
        const before = (s.fields ?? []).length;
        s.fields = (s.fields ?? []).filter((f: any) => !DROP.has(String(f.key)));
        if (s.fields.length !== before) changes.push(`renewal/${s.key}: − ${before - s.fields.length} acknowledgement field(s)`);
      }
      let g = guidanceOf(j);
      if (g.includes(AFS_WAS)) {
        g = g.split(AFS_WAS).join(AFS_NOW);
        changes.push("renewal guidance: the AFS is no longer described as mandatory");
      }
      if (!g.includes(MARKER)) {
        g = `${g.trimEnd()}\n${CLAUSE.trim()}`;
        changes.push("renewal guidance: + one acknowledgement");
      }
      setGuidance(j, g);
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
