/**
 * Stop describing controls the chat does not have.
 *
 * Day 2 bugs #3 and #4: the assistant told customers to "tap the attachment /
 * location icon in the chat input bar" — there is no such icon — and, in the
 * Change Address flow, kept asking for a map pin without ever giving them one,
 * looping on the same request while ignoring the branch they had already
 * chosen.
 *
 * There IS a way to ask for a location: a ```locate block, which renders a real
 * button. The assistant has to emit it rather than describe an interface it
 * cannot see. The server already appends one when the words appear (see
 * lib/locateGuard.ts); this stops the misleading sentence being written in the
 * first place, and stops the loop.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-no-phantom-ui-2026-09-09.ts --env <file> [--apply]
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

const MARKER = "NEVER DESCRIBE A CONTROL YOU HAVE NOT RENDERED (2026-09-09)";
const FENCE = "```";
const RULE =
  " " + MARKER + ": you cannot see the customer's screen and you do not control it, so never tell them to tap, click or find something in the interface." +
  " There is NO attachment icon, NO location icon and NO paperclip in the chat input bar — telling somebody to tap one sends them looking for a thing that is not there, which is what happened on 8 September." +
  " To ask for a location, emit a " + FENCE + "locate block and the button appears by itself. To ask for a file, emit an " + FENCE + "upload block. To offer choices, emit " + FENCE + "buttons or " + FENCE + "cards." +
  " If you have already asked for a location once and it has not arrived, do NOT ask again the same way: say plainly that they can type the address instead, and accept it typed." +
  " And never ask for something you already have — if the address, the branch or the area is already on the case, use it rather than asking the customer to supply it a second time.";

const JOURNEYS = ["personal_po_box_rental", "corporate_po_box_rental", "manage_po_box", "personal_po_box_renewal", "corporate_po_box_renewal"];

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog"));
    if (!row) throw new Error("nxn-dialog not found");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];
    for (const j of def.journeys ?? []) {
      if (!JOURNEYS.includes(j.key)) continue;
      if (String(j.guidance ?? "").includes(MARKER)) { console.log(`  (skip) ${j.key}`); continue; }
      j.guidance = String(j.guidance ?? "") + RULE;
      changes.push(`${j.key}.guidance += no phantom UI`);
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
