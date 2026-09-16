/**
 * The applicant's account link, and the licence member's real field names.
 *
 * YI FANG TAIWAN FRUIT TEA L.L.C, 16 September: three new-licence submissions,
 * each answered "Value does not exist or does not match filter criteria." with
 * every record rolled back, and the applicant told to phone EPGL. The cause was
 * one key — the User item linked the applicant with `EPG_Company__c`, which is
 * the PARTNER's field. EPGL's handler reads `EPG_Account__c` on a User, and
 * neither name exists on the Salesforce User object at all: the wrapper reads
 * them out of the JSON, so a near-miss is not ignored, it is unseen.
 *
 * The guidance already said EPG_Account__c was right — in a sentence
 * immediately after one that says, of EPG_Partner__c, "the account link is
 * EPG_Company__c (NOT EPG_Account__c)". Two objects, two opposite answers, one
 * paragraph. This makes the contrast explicit instead of implied.
 *
 * Members__c is the quieter half. `EPG_Role__c`, `EPG_Nationality__c` and
 * `EPG_Name_Arabic__c` do not exist on that object — a SOQL for any of them is
 * a 400 — and the handler writes the row anyway with those values dropped, so
 * every licence member recorded so far has a name and nothing else. The real
 * fields are the DUL_ ones, verified by submitting them and reading the record
 * back.
 *
 * withEpglRequestFields corrects both deterministically; this stops the model
 * composing them wrong in the first place, so the two agree.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-user-and-member-fields-2026-09-16.ts [--env <file>] [--dry-run]
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
const dryRun = process.argv.includes("--dry-run");

const OLD_MEMBER =
  "Members__c: the account link is AccountId__c (NOT EPG_Account__c); EPG_Contact__c and EPG_Designation__c do NOT exist on this object — never send them.";
const NEW_MEMBER =
  "Members__c has its OWN field names and almost nothing on it starts with EPG_: the account link is AccountId__c (NOT EPG_Account__c); the member's English name goes on BOTH Name and DUL_License_Members_Person_NameEn__c; the Arabic name is DUL_License_Members_Person_NameAr__c; the role is DUL_License_Members_MemberRoleEn__c; the nationality is DULLicenseMembersNationalityEn__c. " +
  "EPG_Role__c, EPG_Nationality__c, EPG_Name_Arabic__c, EPG_Contact__c and EPG_Designation__c do NOT exist on this object — and sending them does not fail, it writes the member with those details SILENTLY MISSING, which is worse.";

const OLD_USER = "EPG_Account__c is correct on this object — do not rename it.";
const NEW_USER =
  "the applicant's link to the company is EPG_Account__c — this is the one object where it is NOT EPG_Company__c, and sending EPG_Company__c on a User rejects the WHOLE composite with \"Value does not exist or does not match filter criteria.\", a message that names no field.";

const EDITS: [string, string][] = [[OLD_MEMBER, NEW_MEMBER], [OLD_USER, NEW_USER]];

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`agent ${SLUG} not found in this database`);
  const def = row.definition as { journeys?: { key: string; submission?: { apiFlow?: { notes?: string } } }[] };

  let changes = 0;
  for (const j of def.journeys ?? []) {
    const flow = j.submission?.apiFlow;
    if (!flow?.notes) continue;
    let notes = flow.notes;
    for (const [from, to] of EDITS) {
      if (notes.includes(to)) continue; // already applied
      if (!notes.includes(from)) continue;
      notes = notes.replace(from, to);
      changes++;
      console.log(`  ${j.key}: ${from.slice(0, 60)}…`);
    }
    if (notes !== flow.notes) flow.notes = notes;
  }

  if (!changes) {
    console.log("✓ Already applied — nothing to change.");
    return;
  }
  console.log(`\n${changes} change(s)`);
  if (dryRun) { console.log("--dry-run, nothing written"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log("written");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
