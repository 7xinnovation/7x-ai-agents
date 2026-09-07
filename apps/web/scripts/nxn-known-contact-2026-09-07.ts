/**
 * Show the contact details on file, do not ask for them again (2026-09-07).
 *
 * Signing in hands us the mobile and the email Emirates Post already holds, and
 * the journey asked for both again from someone who had just proved who they
 * were. They are now seeded into the case at sign-in (lib/knownContact); this is
 * the half the model needs — show them, and let the customer proceed or change
 * them, rather than typing out what we already know.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-known-contact-2026-09-07.ts [--env <file>] [--dry-run]
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
const MARKER = "THE CONTACT DETAILS ARE ALREADY ON FILE";

const TEXT =
  `${MARKER}. A signed-in customer's mobile and email come from their Emirates Post account and are already on the ` +
  "case as contact_phone and contact_email. Do NOT ask for them as though you had nothing.\n\n" +
  "SHOW them and let the customer decide:\n" +
  "```summary\ntitle: Your contact details\n- Mobile: <contact_phone>\n- Email: <contact_email>\n```\n" +
  "```buttons\n- These are correct\n- Change my mobile\n- Change my email\n```\n" +
  "Say in one line that these are the details on their Emirates Post account and that the box confirmation and the " +
  "receipt will go to them. If they choose to change one, ask for that ONE and leave the other alone.\n\n" +
  "A detail that is genuinely missing is still asked for, plainly and on its own — an account without a mobile on " +
  "it is a normal account, not an error, and nothing about it is worth remarking on to the customer. Ask only for " +
  "the field that is missing.\n\n" +
  "Never invent either value, never carry one across from a different customer or an earlier box, and never show a " +
  "detail as confirmed that the customer has not seen on screen.";

interface Journey { key: string; guidance?: string }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys?: Journey[] };
  let changed = 0;

  for (const j of def.journeys ?? []) {
    if (!/rental|renewal|manage/.test(j.key)) continue;
    const without = (j.guidance ?? "")
      .split(/\n{2,}/)
      .filter((p) => !p.includes(MARKER))
      .join("\n\n")
      .trim();
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
