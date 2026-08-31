/**
 * Stop telling the model the box id is "the 2-prefixed one" (2026-08-31).
 *
 * That was learned from MyBox, where FreeBoxes returns uniqueBoxId 2450063 for box
 * 450063. MyHome does not prefix at all — 958009 is both. Following the rule, the
 * model built 2958009, Select answered BOX_NOT_FREE, and the customer was told the
 * box had just been taken by someone else.
 *
 * The id is now corrected server-side against the list the backend actually
 * returned, so this is belt and braces — but the guidance should not be teaching a
 * rule that is only true for one bundle.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/fix-nxn-boxid-guidance-2026-08-31.ts [--env <file>]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "nxn-dialog";
const OLD = "uniqueBoxID = the uniqueBoxId from step 1 (the 2-prefixed one, NOT the box number you showed)";
const NEW =
  "uniqueBoxID = the uniqueBoxId from step 1, COPIED EXACTLY as the tool returned it. Never construct it from the box number: MyBox returns 2450063 for box 450063, MyHome returns 958009 for box 958009, and there is no rule to infer";

interface Journey { key: string; submission?: { apiFlow?: { notes?: string; saveTool?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;
  for (const j of def.journeys) {
    const f = j.submission?.apiFlow;
    const notes = String(f?.notes ?? "");
    if (!notes.includes(OLD)) { console.log(`  (skip) ${j.key}`); continue; }
    f!.notes = notes.split(OLD).join(NEW);
    changed++;
    console.log(`  + ${j.key}`);
  }
  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
