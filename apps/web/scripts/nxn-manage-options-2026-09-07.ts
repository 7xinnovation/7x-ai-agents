/**
 * The manage menu belongs to the box, not to the journey (2026-09-07).
 *
 * Reported: a PERSONAL MyHome box was offered "Link trade license". A trade
 * licence belongs to a corporate subscription — there is nothing on a personal
 * box for one to attach to — so the customer was handed a path that cannot
 * finish. The menu was a fixed list, offered whatever the box turned out to be.
 *
 * The details response now says which options apply (see lib/integrations), and
 * a licence link attempted on a personal box is refused outright. This is the
 * half the model needs BEFORE it draws the buttons.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-manage-options-2026-09-07.ts [--env <file>] [--dry-run]
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
const DRY = process.argv.includes("--dry-run");
const MARKER = "THE MANAGE MENU BELONGS TO THE BOX";

const TEXT =
  `${MARKER}. Read the box's rentType from the details response BEFORE you offer anything, and offer only what that ` +
  "box can actually do.\n" +
  "- A PERSONAL box: renew it, add or remove an authorised agent, auto-renewal, link another box to the account.\n" +
  "- A CORPORATE box: all of the above, and linking a trade licence (Tijari).\n\n" +
  "Never offer to link a trade licence on a personal box. It belongs to a corporate subscription and there is " +
  "nothing on a personal one for it to attach to, so the customer is sent down a path that cannot finish — a MyHome " +
  "customer was offered it on 7 September. Do not list it and then explain why it is unavailable either; simply do " +
  "not offer it.\n\n" +
  "The same rule the other way: do not withhold an option a box does have. If you cannot tell what type the box is, " +
  "fetch its details rather than guessing from the bundle name or from what the customer called it.";

interface Journey { key: string; guidance?: string }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys?: Journey[] };
  let changed = 0;

  for (const j of def.journeys ?? []) {
    if (!/manage|renewal/.test(j.key)) continue;
    const without = (j.guidance ?? "").split(/\n{2,}/).filter((p) => !p.includes(MARKER)).join("\n\n").trim();
    const next = `${without}\n\n${TEXT}`.trim();
    if (next === j.guidance) { console.log(`  (already) ${j.key}`); continue; }
    j.guidance = next;
    changed++;
    console.log(`  ~ ${j.key} (${next.length} chars)`);
  }

  if (changed && !DRY) await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(changed ? (DRY ? `\n--dry-run: ${changed} not written.` : `\n${changed} written.`) : "\nnothing to do.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
