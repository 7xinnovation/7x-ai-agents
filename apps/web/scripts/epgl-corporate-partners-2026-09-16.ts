/**
 * A corporate shareholder is a partner, and it has no passport.
 *
 * JNT EXPRESS COURIER SERVICES L.L.C, 16 September: partner 1 on the trade
 * licence is GLOBAL JET EXPRESS AE FZCO. The extraction read it correctly — that
 * is what the licence says, and a company holding shares in another company is
 * ordinary here. What followed was not ordinary: the journey asked that company
 * for a passport copy and an Emirates ID, which do not exist, and the renewal
 * could not be finished.
 *
 * The identity documents now apply only to partners who are PEOPLE. The type is
 * decided in code from the legal-form markers on the name (withPartnerTypes) and
 * written into the case, so the condition has something to read and the panel
 * shows the same fact.
 *
 * What EPGL want in place of a passport for a corporate partner — their own
 * checklist has "Trade License-Partner" and "Memorandom Of Association-Partner"
 * — is a question for them; until it is answered the assistant says so rather
 * than asking a company for its Emirates ID.
 *
 * Idempotent. Run from apps/web, against an env file or an inherited
 * DATABASE_URL:
 *   npx tsx scripts/epgl-corporate-partners-2026-09-16.ts [--env <file>] [--apply]
 */
import { databaseUrlFromArgs } from "./lib/envFile";

const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const MARKER = "A PARTNER THAT IS A COMPANY (2026-09-16)";

const CLAUSE =
  ` ${MARKER}: a partner on the trade licence may be a COMPANY rather than a person — "GLOBAL JET EXPRESS AE FZCO" is a partner, not a typo. ` +
  "Record the name exactly as printed and do NOT ask a corporate partner for a passport copy, an Emirates ID or a nationality; the system already knows which partners are companies and stops asking for those. " +
  "Say once, plainly, that the partner is a company so no personal identity documents are needed for it, and that EPGL will ask for that company's own licence separately if they need it. " +
  "Never treat a corporate partner as a missing document, never count it as an incomplete partner, and never suggest the customer supply somebody else's passport in its place.";

function guidanceOf(j: Record<string, any>): string {
  const g = j.guidance;
  return typeof g === "string" ? g : String(g?.en ?? "");
}
function setGuidance(j: Record<string, any>, text: string) {
  if (typeof j.guidance === "string") j.guidance = text;
  else j.guidance = { ...j.guidance, en: text };
}

/** The identity documents, which apply to people only. */
const PERSONAL = /^partner_(\d+)_(passport|emirates_id)$/;

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFromArgs() });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];

    for (const j of def.journeys ?? []) {
      for (const s of j.steps ?? []) {
        for (const d of s.documents ?? []) {
          const m = PERSONAL.exec(String(d.key ?? ""));
          if (!m) continue;
          const clause = `partner_${m[1]}_type != 'company'`;
          const cond = String(d.condition ?? "").trim();
          if (cond.includes(clause)) continue;
          d.condition = cond ? `${cond} && ${clause}` : clause;
          changes.push(`${j.key}/${d.key}: + ${clause}`);
        }
      }
      const g = guidanceOf(j);
      if (!g.includes(MARKER) && (j.key === "renewal" || j.key === "new_license")) {
        setGuidance(j, `${g.trimEnd()}\n${CLAUSE.trim()}`);
        changes.push(`${j.key} guidance: + a partner that is a company`);
      }
    }

    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} change(s):`);
    for (const c of changes.slice(0, 8)) console.log(`   ~ ${c}`);
    if (changes.length > 8) console.log(`   … and ${changes.length - 8} more`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else console.log("\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
