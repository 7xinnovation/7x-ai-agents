/**
 * NewContact and NewUser are two different people, and we were sending one.
 *
 * Every EPGL submission on 9 September was rejected with
 *
 *   Rolled back due to allOrNone=true:
 *   Either of Is Primary Contact or  Is Secondary Contact should be selected
 *
 * which reads like a missing flag and is not one. Salesforce's 9 Sep note
 * explains it: their CompositeHandler builds a Contact from NewUser and marks it
 * PRIMARY, builds a Contact from NewContact and marks it SECONDARY, and matches
 * Contact on Email. The applicant's email in NewContact therefore updates the
 * Primary contact a previous submission had already created for that same
 * person, asking Salesforce to mark one record both -- which the rule refuses,
 * correctly.
 *
 * Their swagger says the same thing in two words, once each:
 *   Contact  "Secondary contacts."
 *   User     "Portal applicant."
 *
 * The composite is assembled by the MODEL, so this is the half of the fix that
 * has to live in guidance. The other half is deterministic and already in
 * apps/web/lib/epglFields.ts: a NewContact row whose Email matches NewUser's is
 * dropped before the payload is sent, so a slip here cannot reach Salesforce.
 *
 * Also handles the error itself. Left to its own devices the model read the
 * rolled-back message -- echoed identically onto all nine items -- as an Account
 * problem, tried the flag on the Account, tried again, then offered a callback
 * for an application that was complete. It now knows what the message means and
 * what to ask for.
 *
 * Idempotent, both journeys. Run from apps/web:
 *   npx tsx scripts/epgl-contact-vs-user-2026-09-09.ts --env <file> [--apply]
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
const MARKER = "WHO GOES IN NewContact AND WHO GOES IN NewUser (2026-09-09)";

const RULE =
  ` ${MARKER}: these are two different objects for two different people, and sending one person as both is what rejected every submission on 9 September.` +
  ` NewUser is the APPLICANT — the person in this conversation, the one whose contact_name/contact_email/contact_phone you collected. Salesforce creates their Contact and marks it PRIMARY. Send them here, with EPG_Emirates_Id__c so a resubmission matches instead of duplicating.` +
  ` NewContact is for a SECOND, DIFFERENT person at the company — Salesforce marks it SECONDARY. Only send it if the customer has actually named someone else, with that person's own email.` +
  ` NEVER put the same email in both. Salesforce matches Contact on Email, so the same address in NewContact updates the applicant's own Primary contact and tries to mark it Secondary too — one person cannot be both, and the whole composite is rolled back.` +
  ` If you have only one contact person, send NewUser and NO NewContact at all. That is complete, not a gap.` +
  ` Do not set Is_Primary_Contact__c or Is_Secondary_Contact__c yourself — Salesforce sets the designation from which object you used, and our integration user cannot write either field.` +
  ` IF THE SUBMISSION FAILS WITH "Either of Is Primary Contact or  Is Secondary Contact should be selected": that is this, and nothing to do with the Account. It means the contact email you sent already exists on that company as its portal applicant. Do NOT retry the same payload, do NOT put the flag on the Account, and do NOT offer a callback — the application is complete.` +
  ` Say plainly that the contact email is already registered on the company as its main contact, and ask whether there is a different person to name as the additional contact, or whether to submit with just the applicant. Then resubmit accordingly.`;

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];

    for (const j of def.journeys ?? []) {
      const notes = j?.submission?.apiFlow?.notes;
      if (typeof notes !== "string") continue;
      if (notes.includes(MARKER)) continue;
      j.submission.apiFlow.notes = notes + RULE;
      changes.push(`${j.key}: apiFlow.notes += who goes where, and what the rule means`);
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
