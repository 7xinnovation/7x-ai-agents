/**
 * The Form 9 is not collected here.
 *
 * Emirates Post, 15 September: stop asking for it on the renewal. Form 9 is a
 * quarterly revenue return filed on EPGL's own platform, not a document a
 * renewal applicant hands over — and whether a company's returns are up to date
 * is something EPGL will tell us from a list, later. If they are outstanding the
 * customer completes them outside the widget before the renewal can proceed.
 *
 * WHAT IS REMOVED is the UPLOAD. What stays is everything that reads Form 9
 * DATA: epgl_form9_history returns the quarters already filed against the
 * company with their leviable and non-leviable revenue, and the renewal's
 * financial summary is built from those. The figures never came from the
 * uploaded PDF in the first place when the company was known to EPGL — the
 * upload was the fallback, and it was mandatory, so every applicant met it
 * whether or not it was needed.
 *
 * NOT BUILT: the gate. There is no list yet, so nothing here refuses a renewal
 * on an outstanding Form 9 — the assistant simply does not ask for the document,
 * and says where it is completed if the customer raises it. Adding a gate we
 * cannot evaluate would refuse people for a condition we cannot see.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-renewal-no-form9-2026-09-15.ts --env <file> [--apply]
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

/** Sentences that told the assistant to read the figures off an upload. */
const EDITS: [string, string][] = [
  [
    "- READ THE FIGURES, DO NOT DICTATE THEM: the quarterly leviable-income figures are printed on the Form 9.",
    "- READ THE FIGURES, DO NOT DICTATE THEM: the quarterly leviable-income figures come from the Form 9 returns ALREADY FILED with EPGL — call epgl_form9_history with the company's accountId and use what it returns.",
  ],
  [
    "Only ask the customer to type a figure that is genuinely missing from the Form 9 or that they want to correct.",
    "Only ask the customer to type a figure that epgl_form9_history does not return for a quarter in the licence period, or one they want to correct.",
  ],
];

const RULE =
  "THE FORM 9 IS NOT COLLECTED HERE (2026-09-15): do NOT ask the customer to upload a Form 9, do not list it among the documents they should have ready, and do not describe the renewal as incomplete without it. It is a quarterly revenue return filed on EPGL's own platform, not a document that changes hands in this conversation. " +
  "The FIGURES still matter and still come from Form 9 — from the returns already filed, through epgl_form9_history, not from a PDF. " +
  "If the customer asks about their Form 9, or says theirs is outstanding: it is completed on the EPGL platform, outside this chat, and a renewal cannot be processed while returns are missing. Say that plainly, do not offer to take it here, and do not tell them whether their own returns are outstanding unless epgl_form9_history actually shows a gap — we are not yet given that list, and guessing at somebody's compliance is worse than saying you cannot see it. ";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  const changes: string[] = [];
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!row) throw new Error("epgl-dialog not found in this database");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const j = (def.journeys ?? []).find((x: any) => x.key === "renewal");
    if (!j) throw new Error("the renewal journey is gone");

    for (const step of j.steps ?? []) {
      const before = (step.documents ?? []).length;
      step.documents = (step.documents ?? []).filter((d: any) => d.key !== "form_9");
      if (step.documents.length !== before) changes.push(`renewal/${step.key}: − form_9`);
    }

    let g = String(j.guidance ?? "");
    for (const [from, to] of EDITS) {
      if (!g.includes(from)) continue;
      g = g.split(from).join(to);
      changes.push(`renewal: "${from.slice(0, 46)}…"`);
    }
    if (!g.includes(RULE.trim())) {
      g = `${g.trimEnd()}\n\n${RULE.trim()}`;
      changes.push("renewal: the Form 9 is not collected here");
    }
    j.guidance = g;

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
