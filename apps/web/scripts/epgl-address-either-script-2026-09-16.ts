/**
 * The registered address, in whichever script the licence prints it (2026-09-16).
 *
 * ECONOMIC ADVANTAGE INFORMATION TECHNOLOGY CONSULTANTS, licence 862401: the
 * trade licence carries its address on one Arabic line and no English one at
 * all. Once the extractor was taught to put an Arabic-only address in the
 * Arabic field, the ENGLISH street address — required, and with nothing on the
 * licence to fill it — was left outstanding, so the applicant was asked for a
 * street address their own licence does not carry and offered a map pin for it.
 *
 * Asking is the wrong answer twice over: the address IS on the document, and
 * the customer would have to translate their own registered address to satisfy
 * a field. So the English one is required only when the Arabic one is empty —
 * `!address_street_ar`, the condition form added for this.
 *
 * WHAT GOES TO SALESFORCE. BillingStreet takes the English address when there
 * is one and the Arabic address when there is not: their record should carry
 * the registered address as printed, not a translation we invented.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-address-either-script-2026-09-16.ts [--env <file>] [--dry-run]
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

const SLUG = "epgl-dialog";
const CONDITION = "!address_street_ar";
const NOTE =
  " THE ADDRESS MAY BE PRINTED IN ONE SCRIPT ONLY. Many Dubai licences carry the whole registered address on a single Arabic line and no English one. That is a complete address: do NOT ask the applicant for an English street address the licence does not carry, and do not offer a map pin to make one up. Send BillingStreet as the English address when there is one and the Arabic address when there is not.";
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`agent ${SLUG} not found in this database`);
  const def = row.definition as {
    journeys?: {
      key: string;
      steps: { fields: { key: string; condition?: string }[] }[];
      submission?: { apiFlow?: { notes?: string } };
    }[];
  };

  let changes = 0;
  for (const j of def.journeys ?? []) {
    for (const s of j.steps ?? []) {
      const f = s.fields?.find((x) => x.key === "address_street");
      if (!f || f.condition === CONDITION) continue;
      console.log(`  ${j.key}: address_street condition ${f.condition ?? "(none)"} -> ${CONDITION}`);
      f.condition = CONDITION;
      changes++;
    }
    const flow = j.submission?.apiFlow;
    if (flow?.notes && !flow.notes.includes("PRINTED IN ONE SCRIPT ONLY")) {
      console.log(`  ${j.key}: submission note added`);
      flow.notes += NOTE;
      changes++;
    }
  }

  if (!changes) { console.log("✓ Already applied — nothing to change."); return; }
  console.log(`\n${changes} change(s)`);
  if (dryRun) { console.log("--dry-run, nothing written"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log("written");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
