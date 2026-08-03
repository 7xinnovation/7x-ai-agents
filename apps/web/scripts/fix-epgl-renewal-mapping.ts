/**
 * Fix the EPGL submission field mapping that made renewals dead-end.
 *
 * Reported: a renewal submit looped on "Account record requires a Company Name in
 * English field and a License No field", then "existing Account record with a
 * unique conflict", then "unable to retrieve the Account ID" — and ended in a
 * callback offer.
 *
 * Three causes, all in the apiFlow notes rather than the code:
 *
 * 1. The notes told the agent that for an update it must "first call
 *    duplicateCheck (or getRequestStatus) to obtain the existing Account Id" and
 *    put it in Account.Id. That is impossible: DuplicateCheckResponse returns only
 *    matchFound / matchedRecordIds / matchedRequests (status, number,
 *    recommendedAction) — there is no Account Id in the contract. The agent
 *    correctly reported it could not get one and gave up.
 *    It never needed one: the Account schema documents
 *    "Upsert key – EPG_Trade_license_no__c", and the renewal example says the
 *    Account is "matched and updated by trade license no." Omitting Id and sending
 *    the trade licence number is the documented path.
 *
 * 2. The company's English name is the STANDARD `Name` field on Account
 *    (required: [Name, EPG_Trade_license_no__c, RecordTypeId]). The agent was
 *    inventing a custom "Company Name in English" field, which does not exist.
 *
 * 3. "License No": EPG_Finance_Summary__c needs a License lookup, which the
 *    handler derives from the Account's EPG_License__c. When that is empty every
 *    quarter row fails with "No License found for this Account" and the whole
 *    composite rolls back. The spec's documented remedy is to send
 *    EPG_License_No__c on each row — which is exactly why the renewal journey now
 *    captures the postal license number as a required field (FB-1447).
 *
 * Run from apps/web:  DATABASE_URL="<env>" npx tsx scripts/fix-epgl-renewal-mapping.ts [--dry-run]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The impossible instruction, present verbatim in both journeys' notes.
const BAD_UPDATE_TEXT =
  "For an UPDATE, first call epglsalesforce__duplicateCheck (or getRequestStatus) to obtain the existing Account Id and License Request Name, put them in the Account.Id / EPG_License_Request__c.Name fields, and still include every item's url as above.";

const GOOD_UPDATE_TEXT =
  "MATCHING AN EXISTING COMPANY — NEVER HUNT FOR AN ACCOUNT ID. The Account's upsert key is EPG_Trade_license_no__c, so a company that already exists is matched and updated by its TRADE LICENCE NUMBER alone. Send the Account item WITHOUT an Id field and include EPG_Trade_license_no__c; the handler updates the existing record. Do NOT try to obtain an Account Id from duplicateCheck or getRequestStatus — the contract does not return one (duplicateCheck returns only matchFound, matchedRecordIds and matchedRequests with their status/number/recommendedAction), so looking for it is a dead end. If a response mentions a duplicate or unique conflict on the Account, that means the company already exists and you should re-send with the SAME trade licence number and no Id, not create a new company and not give up. Every item still needs its method, referenceId and url exactly as listed above.";

const FIELD_MAPPING_NOTE =
  " ACCOUNT FIELD NAMES (do not invent custom fields): the company's ENGLISH name is the STANDARD `Name` field on Account — there is no 'Company Name in English' custom field. The Arabic name is EPG_Company_Name_Arabic__c. The Account requires exactly Name, EPG_Trade_license_no__c and RecordTypeId; the only other editable fields on a renewal are EPG_Trade_license_Expiry_date__c, EPG_Trade_Name_in_English__c and EPG_Trade_Name_in_Arabic__c (everything else on the Account is read-only for the portal).";

const LICENSE_NO_NOTE =
  " LICENSE NO ON EVERY FINANCE ROW: EPG_Finance_Summary__c needs a License lookup, which the handler derives from the Account's EPG_License__c. When that field is empty the response is 'No License found for this Account' repeated per quarter and the WHOLE composite rolls back. Prevent it by sending EPG_License_No__c: '<the customer's postal license number>' on EVERY EPG_Finance_Summary__c row, alongside Quarter__c, EPG_Year__c, Name and the income fields. The renewal journey captures postal_license_number for exactly this reason — if it is missing from the case, ask for it BEFORE submitting rather than submitting without it. If the response still reports no license found, the company has no active licence to renew: say so plainly and offer to start a new licence application.";

const MARKER = "NEVER HUNT FOR AN ACCOUNT ID";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog not found");
  const def = agent.definition as any;

  const changes: string[] = [];
  const warnings: string[] = [];

  for (const j of def.journeys as any[]) {
    const flow = j.submission?.apiFlow;
    if (!flow?.notes) continue;
    let notes: string = flow.notes;
    if (notes.includes(MARKER)) {
      changes.push(`  · ${j.key}: already corrected`);
      continue;
    }

    if (notes.includes(BAD_UPDATE_TEXT)) {
      notes = notes.replace(BAD_UPDATE_TEXT, GOOD_UPDATE_TEXT);
      changes.push(`  · ${j.key}: replaced the impossible "obtain the Account Id" instruction`);
    } else {
      warnings.push(`  ! ${j.key}: the Account-Id instruction was not found verbatim; appending the correction instead`);
      notes += ` ${GOOD_UPDATE_TEXT}`;
    }

    notes += FIELD_MAPPING_NOTE;
    changes.push(`  · ${j.key}: added the Account field-name mapping`);

    // The finance-summary rows only exist on the renewal composite.
    if (j.key === "renewal") {
      notes += LICENSE_NO_NOTE;
      changes.push(`  · ${j.key}: added EPG_License_No__c on every finance row`);
    }

    flow.notes = notes;
  }

  if (!dryRun && changes.length) {
    await db.update(agents).set({ definition: def, updatedAt: new Date() }).where(eq(agents.id, agent.id));
  }

  console.log(dryRun ? "DRY RUN — no writes\n" : "");
  for (const c of changes) console.log(c);
  for (const w of warnings) console.log(w);
  console.log(`\n${changes.length} change(s), ${warnings.length} warning(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
