/**
 * The field nobody could have accepted (2026-11-02, EPGL 2.0).
 *
 * Reported with a screenshot of the submission, and the question was about the
 * half the customer could see: "why is it showing that to the customer in the
 * first place". That half is now code — see lib/internalsGuard.ts, which
 * withholds any sentence naming a field, an Apex class or the shape of our own
 * request. This is the other half: why there was anything to say.
 *
 * The call log for LR-54109 (conversation 353bb0a9, 12:42 UTC) shows the first
 * composite carrying `Licensing_Tier_Declared__c` and coming back with
 *
 *   Invalid value was provided for "Licensing Tier (Declared)". Please send a
 *   valid value. | A required field value is missing: "Account". ×2
 *
 * The catalogue's applicationFields call that field `Declared_Tier__c`, say it
 * is NOT required, and say it defaults to the product's own tier. So the name
 * was composed rather than copied, and it was sent at all for a value nobody
 * had asked for.
 *
 * Idempotent. From apps/web:
 *   npx tsx scripts/epgl-20-invented-fields-2026-11-02.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
// 2.0 moved to its own agent on 2 November; epgl-dialog is 1.0 again.
const SLUG = arg("--slug") ?? "epgl-dialog-2";
const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

export const MARKER = "A FIELD NAME IS COPIED, NEVER COMPOSED (2026-11-02";

export const RULE = `
${MARKER}).

EVERY NAME IN A SUBMISSION COMES FROM THE CATALOGUE. The catalogue answers, in this conversation, with the exact application fields for the product being applied for — their names, whether each is required, and what their values may be. Those names are the only ones that may appear in a composite body. On 2 November the submission carried Licensing_Tier_Declared__c; the catalogue calls that field Declared_Tier__c. The request was refused, the customer watched it fail, and the name had been assembled out of the words in its label rather than read from the answer sitting in the conversation. If you cannot point at the line of the catalogue a name came from, you invented it.

AND AN OPTIONAL FIELD YOU HAVE NO VALUE FOR IS LEFT OUT. The same field is marked not required and documented as defaulting to the product's own tier — so the correct thing to send was nothing at all. Sending a guess where the service has a default replaces something right with something you made up, and the only possible outcomes are no change or a rejection. Where the catalogue marks a field required and you genuinely do not have it, ask the customer for it; where it is optional and unanswered, omit it.

A PICKLIST TAKES ONE OF ITS OWN VALUES. Where the catalogue lists what a field may contain — General, Specialised, Projects and Establishments for the tier; Domestic or Domestic and International for the scope — send one of those strings exactly, or send nothing. Never a near-miss, never the customer's phrasing, never a translation of one.
`.trim();

async function main() {
  const env = arg("--env");
  if (!env) throw new Error("--env <envfile> is required");
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(env) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];
    for (const j of def.journeys ?? []) {
      const g = String(j.guidance ?? "");
      if (g.includes(MARKER)) continue;
      j.guidance = `${g.trimEnd()}\n\n${RULE}`;
      changes.push(`${j.key}: +${RULE.length} chars of guidance`);
    }
    if (!changes.length) { console.log(`${SLUG}: nothing to do — already applied.`); return; }
    console.log(`${SLUG} — ${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else {
      console.log("\ndry run — pass --apply to write.");
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.includes("epgl-20-invented-fields-2026-11-02")) void main();
