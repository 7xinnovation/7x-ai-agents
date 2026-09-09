/**
 * Stop asking for the owner's Emirates ID separately.
 *
 * It is always partner 1's. The journey carried both an `emirates_id` slot (the
 * owner's, optional) and `partner_1_emirates_id` (mandatory), and the upload
 * route already mirrors an identity document between the two in either
 * direction — so the second ask was for a card we had just been given, and
 * uploading it twice is what a customer reasonably finds stupid.
 *
 * Removing the OWNER slot rather than the partner one is deliberate: partner 1
 * is mandatory and named on the licence, the owner slot was optional and
 * duplicated it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-drop-owner-eid-2026-09-09.ts --env <file> [--apply]
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
/** The owner's own slot. partner_1_emirates_id stays. */
const DROP = "emirates_id";
const MARKER = "THE OWNER'S EMIRATES ID (2026-09-09)";
const RULE =
  ` ${MARKER}: do NOT ask for the owner's Emirates ID as a separate document. The owner is partner 1, so their card is partner_1_emirates_id and asking twice asks for the same file twice.` +
  ` If the customer mentions the owner's ID, treat it as partner 1's.`;

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];

    for (const j of def.journeys ?? []) {
      for (const step of j.steps ?? []) {
        const before = (step.documents ?? []).length;
        step.documents = (step.documents ?? []).filter((d: any) => d?.key !== DROP);
        if (step.documents.length !== before) changes.push(`${j.key}/${step.key}: removed the ${DROP} slot`);
      }
      // And the field, if the panel carried one for it.
      for (const step of j.steps ?? []) {
        const before = (step.fields ?? []).length;
        step.fields = (step.fields ?? []).filter((f: any) => f?.key !== "owner_emirates_id_doc");
        if ((step.fields ?? []).length !== before) changes.push(`${j.key}/${step.key}: removed owner_emirates_id_doc`);
      }
      if (j.key === "new_license" && !String(j.guidance ?? "").includes(MARKER)) {
        j.guidance = String(j.guidance ?? "") + RULE;
        changes.push("new_license.guidance += do not ask twice");
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
