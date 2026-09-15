/**
 * The licence is not ours to grant, and the assistant should say so.
 *
 * The pre-launch gate checks it under Transparency & trust, and the artefact
 * fixes the wording: القرار التنظيمي النهائي يصدر من الجهة أو الموظف المخول
 * وليس من Dialog. Nothing in the deployed EPGL guidance said it, so a customer
 * reading "your application has been approved" could reasonably take the
 * approval to be the assistant's own.
 *
 * It matters beyond the score. This agent submits a licence application, quotes
 * a fee, collects it, and reports a status back — from the outside that is
 * indistinguishable from an authority deciding, and the one sentence that
 * distinguishes them was missing.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-decision-authority-2026-09-15.ts --env <file> [--apply]
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

const SLUG = "epgl-dialog";
const MARKER = "WHO DECIDES (2026-09-15)";

/** The artefact's wording, in both languages, plus what it means in practice. */
const CLAUSE =
  ` ${MARKER}: the final regulatory decision is issued by Emirates Post Group Licensing — the authorised entity or officer — and never by this assistant. ` +
  "القرار التنظيمي النهائي يصدر من الجهة أو الموظف المخول وليس من المساعد. " +
  "You submit the application, you report what EPGL's own record says about it, and you never approve, reject, grant, refuse or promise a licence. " +
  "Say \"your application has been submitted and EPGL will review it\", never \"your application has been approved\" unless their status endpoint says so — and when it does, attribute it: \"EPGL have approved it\". " +
  "The same holds for a refusal: relay it as theirs, say the decision rests with the authorised officer, and point to the enquiry route rather than defending or explaining the decision as if it were yours.";

function guidanceOf(j: Record<string, any>): string {
  const g = j.guidance;
  return typeof g === "string" ? g : String(g?.en ?? "");
}
function setGuidance(j: Record<string, any>, text: string) {
  if (typeof j.guidance === "string") j.guidance = text;
  else j.guidance = { ...j.guidance, en: text };
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
      const g = guidanceOf(j);
      if (g.includes(MARKER)) continue;
      setGuidance(j, `${g.trimEnd()}\n${CLAUSE.trim()}`);
      changes.push(`${j.key}: + who decides`);
    }
    // The persona carries it too: a question asked before any journey starts is
    // answered from the persona, and "will you approve my licence?" is one.
    if (typeof def.persona === "string" && !def.persona.includes(MARKER)) {
      def.persona = `${def.persona.trimEnd()}\n${CLAUSE.trim()}`;
      changes.push("persona: + who decides");
    } else if (def.persona && typeof def.persona === "object" && !JSON.stringify(def.persona).includes(MARKER)) {
      def.persona = { ...def.persona, en: `${String(def.persona.en ?? "").trimEnd()}\n${CLAUSE.trim()}` };
      changes.push("persona: + who decides");
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
