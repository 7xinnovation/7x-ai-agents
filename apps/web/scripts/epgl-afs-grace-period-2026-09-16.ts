/**
 * A renewal does not wait for the audited accounts.
 *
 * EPGL's licensing team, 16 September: "CEPs can renew their license without
 * submitting the AFS. However, they will be tagged in the system as partially
 * completed, as they have a 6 month grace period to submit it. If they do not
 * submit the AFS, they can submit an acknowledgment letter instead."
 *
 * The journey had it as MANDATORY, which is the one reading that cannot be
 * right: a company whose audit is not finished — the ordinary case in the months
 * after a financial year closes — could not renew at all, and the licence
 * expires while they wait for their auditor. Both test packs EPGL sent on the
 * 16th carry a trial balance and no AFS, which is the same fact arriving twice.
 *
 * So it becomes optional, and the assistant explains the choice rather than
 * silently skipping it: submit the AFS now, or renew without it and follow
 * within six months, or send the acknowledgement letter instead. What it must
 * not do is let someone think they have finished when their application will sit
 * as partially completed.
 *
 * Idempotent. Run from apps/web, against an env file or an inherited
 * DATABASE_URL:
 *   npx tsx scripts/epgl-afs-grace-period-2026-09-16.ts [--env <file>] [--apply]
 */
import { databaseUrlFromArgs } from "./lib/envFile";

const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const MARKER = "THE AFS AND ITS GRACE PERIOD (2026-09-16)";

const CLAUSE =
  ` ${MARKER}: the Audited Financial Statement is NOT a condition of renewing. EPGL's licensing team: a courier can renew without it, ` +
  "the application is then tagged PARTIALLY COMPLETED, and they have SIX MONTHS to submit it; if they do not submit the AFS they may submit an audit acknowledgement letter instead. " +
  "So ask for it once, plainly, and offer the three ways forward in the same message: upload the AFS now, upload the acknowledgement letter instead, or continue without either and send it within six months. " +
  "NEVER block the renewal on it, never re-ask after they have chosen, and never describe the renewal as incomplete because of it. " +
  "When they continue without it, say once — before payment, not after — that the application will be recorded as partially completed until the AFS or the acknowledgement letter reaches EPGL, and that the six months run from now. " +
  "Do not invent a date for the deadline unless you are told one.";

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
        for (const d of s.documents ?? []) {
          if (d.key !== "audited_financial_statement" || d.requirement !== "mandatory") continue;
          d.requirement = "optional";
          changes.push(`renewal/${d.key}: mandatory → optional`);
        }
      }
      const g = guidanceOf(j);
      if (!g.includes(MARKER)) {
        setGuidance(j, `${g.trimEnd()}\n${CLAUSE.trim()}`);
        changes.push("renewal guidance: + the AFS and its grace period");
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
