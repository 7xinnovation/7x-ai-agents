/**
 * The fee is AED 150,000, and the SLA is one business day — eight working hours.
 *
 * The fee sat at 100,000 in six knowledge-base answers, English and Arabic,
 * while production charges 150,000. I left it yesterday on the grounds that a
 * published figure is EPGL's to change; they have now confirmed 150,000 is the
 * current one and the 100,000 comments are out of date. An applicant being
 * quoted one number and charged another is the worst kind of wrong answer,
 * because they only find out at the gateway.
 *
 * All six are the SAME fee said different ways — the annual licensing fee, the
 * minimum paid in advance, and the prescribed fee in the requirements list. The
 * 10% levy on leviable services and the AED 2 per shipment are separate charges
 * and are untouched.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-kb-fee-and-sla-2026-09-11.ts --env <file> [--apply]
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
import { agents, kbChunks } from "@dialog/db";
import { eq } from "drizzle-orm";

const EDITS: [string, string][] = [
  ["AED 100,000", "AED 150,000"],
  ["100,000 درهم", "150,000 درهم"],
  // The SLA in EPGL's own units.
  ["typically within one business day", "typically within one business day (8 working hours)"],
  ["(typically within one business day)", "(typically within one business day, 8 working hours)"],
  ["خلال يوم عمل واحد تقريباً", "خلال يوم عمل واحد تقريباً (8 ساعات عمل)"],
];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents, kbChunks } });
  const changes: string[] = [];
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!agent) throw new Error("epgl-dialog not found in this database");
    const rows = await db.select().from(kbChunks).where(eq(kbChunks.agentId, agent.id));
    for (const row of rows) {
      let next = row.content;
      for (const [from, to] of EDITS) {
        // Skip a substitution that has already been made, so a second run does
        // not turn "(8 working hours)" into "(8 working hours) (8 working hours)".
        if (next.includes(to)) continue;
        if (next.includes(from)) next = next.split(from).join(to);
      }
      if (next === row.content) continue;
      changes.push(`${row.id.slice(0, 8)} — ${row.content.slice(0, 56).replace(/\s+/g, " ")}…`);
      if (APPLY) await db.update(kbChunks).set({ content: next }).where(eq(kbChunks.id, row.id));
    }
    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} chunk(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    console.log(APPLY ? "\nwritten." : "\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
