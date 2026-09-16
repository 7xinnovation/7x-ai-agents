/**
 * The names on the licence that are not shareholders.
 *
 * A UAE trade licence carries two tables. "Partners / الشركاء" are the
 * shareholders; "License Members / الاطراف" is everyone else the licence names —
 * a manager, a signatory, a service agent — with their nationality and role and
 * usually no share at all.
 *
 * We read the first and ignored the second. JNT's licence names ZHAO ZHAO as
 * Manager, his Emirates ID and passport were in the document pack, and the
 * application had nowhere to put them: not a partner, so no slot, and to the
 * identity check a stranger whose documents would have been refused as "not
 * named on this application".
 *
 * So the table is read and recorded. A member is NOT promoted to a partner —
 * they hold no shares and the submission would be wrong — but they are named,
 * the panel shows them, and their documents are recognised as belonging to this
 * licence.
 *
 * Whether EPGL want a manager's identity documents WITH the application is
 * theirs to answer; until they do, we record who they are and ask for nothing.
 *
 * Idempotent. Run from apps/web, against an env file or an inherited
 * DATABASE_URL:
 *   npx tsx scripts/epgl-licence-members-2026-09-16.ts [--env <file>] [--apply]
 */
import { databaseUrlFromArgs } from "./lib/envFile";

const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const MARKER = "LICENCE MEMBERS (2026-09-16)";
/** Four is what these licences carry; the table is not a partner list. */
const MAX_MEMBERS = 4;

const CLAUSE =
  ` ${MARKER}: a trade licence carries TWO tables of names. "Partners / الشركاء" are the shareholders and fill the partner fields. ` +
  '"License Members / الاطراف" is everyone else the licence names — a manager, a signatory, a service agent — with a role and usually no share. ' +
  "Read that table too and record each one with collect_field: member_count, and per member member_N_name, member_N_name_ar, member_N_nationality and member_N_role, exactly as printed. " +
  "A MEMBER IS NOT A PARTNER: never put one in a partner field, never count them in partner_count, and never ask them for a passport or Emirates ID as though they were a shareholder. " +
  "If the customer offers a member's identity document, accept it — that person is named on the licence — and say it is kept with the application. " +
  "If the licence has no members table, record nothing and say nothing about it.";

const FIELDS = (n: number) => [
  { key: `member_${n}_name`, label: { en: `Licence member ${n} — full name as printed`, ar: `الطرف ${n} — الاسم كما هو مطبوع` }, type: "text", validation: { required: false } },
  { key: `member_${n}_name_ar`, label: { en: `Licence member ${n} — full name in Arabic`, ar: `الطرف ${n} — الاسم بالعربية` }, type: "text", validation: { required: false } },
  { key: `member_${n}_nationality`, label: { en: `Licence member ${n} — nationality`, ar: `الطرف ${n} — الجنسية` }, type: "text", validation: { required: false } },
  { key: `member_${n}_role`, label: { en: `Licence member ${n} — role on the licence`, ar: `الطرف ${n} — الصفة` }, type: "text", validation: { required: false } },
];

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
      if (j.key !== "renewal" && j.key !== "new_license") continue;
      // The step that already holds what was read off the licence.
      const step =
        (j.steps ?? []).find((s: any) => /license_review|licence_review/.test(String(s.key))) ??
        (j.steps ?? []).find((s: any) => (s.fields ?? []).some((f: any) => /^partner_1_name$/.test(f.key)));
      if (!step) { console.log(`   ! ${j.key}: no licence-review step found, skipped`); continue; }
      const have = new Set((step.fields ?? []).map((f: any) => f.key));
      const add: any[] = [];
      if (!have.has("member_count")) {
        add.push({ key: "member_count", label: { en: "Licence members named", ar: "عدد الأطراف" }, type: "text", validation: { required: false } });
      }
      for (let n = 1; n <= MAX_MEMBERS; n++) for (const f of FIELDS(n)) if (!have.has(f.key)) add.push(f);
      if (add.length) {
        step.fields = [...(step.fields ?? []), ...add];
        changes.push(`${j.key}/${step.key}: + ${add.length} member field(s)`);
      }
      const g = guidanceOf(j);
      if (!g.includes(MARKER)) {
        setGuidance(j, `${g.trimEnd()}\n${CLAUSE.trim()}`);
        changes.push(`${j.key} guidance: + licence members`);
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
