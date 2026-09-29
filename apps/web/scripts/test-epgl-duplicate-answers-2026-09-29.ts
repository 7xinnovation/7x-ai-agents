/**
 * What EPGL answered about the rolled-back renewal (2026-09-29).
 *
 * TRAHEEL DELIVERY SERVICES L.L.C, 24 September: a second renewal request was
 * rolled back with "A record already exists with the same unique value for
 * 'one of the unique fields'", repeated identically on all seven items because
 * allOrNone unwinds the whole composite. Nothing said which field.
 *
 * We wrote it up and guessed at NewUser — a Username is unique org-wide and the
 * applicant had submitted before. Wrong. EPGL's answers:
 *
 *   - the constraint is the COMPANY NAME, via a duplicate rule on their org
 *     (and EPG_TRN_No__c, which we have never sent);
 *   - a second open request for the same trade licence IS allowed — their
 *     duplicate-check's "Update existing application" is a recommendation;
 *   - User is matched on EPG_Emirates_Id__c and Contact on EMAIL, so a
 *     returning applicant updates rather than collides.
 *
 * The Account was the one item we had ruled out, because it carries an Id.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-duplicate-answers-2026-09-29.ts
 */
import { readFileSync } from "node:fs";
import { withEpglRequestFields } from "../lib/integrations";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

const ACCOUNT_ID = "001FW00B34EmqMWYEZ";
const renewal = () => ({
  body: {
    allOrNone: true,
    compositeRequest: [
      {
        method: "POST",
        referenceId: "Account",
        url: "/services/data/v66.0/sobjects/Account",
        body: {
          Id: ACCOUNT_ID,
          Name: "TRAHEEL DELIVERY SERVICES L.L.C",
          RecordTypeId: "0125f000001xIheAAE",
          EPG_Trade_license_no__c: "1196781",
          EPG_Trade_license_Expiry_date__c: "2027-06-07",
          EPG_Trade_Name_in_English__c: "TRAHEEL DELIVERY SERVICES L.L.C",
        },
      },
      {
        method: "POST",
        referenceId: "NewContact",
        url: "/services/data/v66.0/sobjects/Contact",
        body: {
          // The applicant's address, on the ACCOUNTANT's contact — as sent on
          // 24 September. With email as the match key this does not create a
          // contact, it overwrites the applicant's.
          Email: "emre.karayalcin@7x.ae",
          LastName: "HALL",
          FirstName: "FAHAD SALEH ALI MOHAMMAD",
          EPG_Designation__c: "Accountant",
          EPG_Account__c: ACCOUNT_ID,
        },
      },
      {
        method: "POST",
        referenceId: "NewLicenseRequest",
        url: "/services/data/v66.0/sobjects/EPG_License_Request__c",
        body: { EPG_Account__c: ACCOUNT_ID, EPG_Trade_license_no__c: "1196781" },
      },
    ],
  },
});
const item = (out: any, ref: string) =>
  out.body.compositeRequest.find((i: any) => i.referenceId === ref).body;

console.log("\nThe company name is not resent on a record we address by Id");
{
  const out: any = withEpglRequestFields(renewal(), { accountId: ACCOUNT_ID });
  const a = item(out, "Account");
  check("Name is dropped", a.Name === undefined, a);
  check("...and the Id it is addressed by stays", a.Id === ACCOUNT_ID);
  // What a renewal genuinely updates.
  check("...the trade licence number stays", a.EPG_Trade_license_no__c === "1196781");
  check("...its expiry stays", a.EPG_Trade_license_Expiry_date__c === "2027-06-07");
  check("...and the record type stays", a.RecordTypeId === "0125f000001xIheAAE");
}
{
  // A NEW application has no Id: there the name is what their handler matches
  // on, and dropping it would leave nothing to match.
  const input: any = renewal();
  delete input.body.compositeRequest[0].body.Id;
  const out: any = withEpglRequestFields(input, {});
  check("a new application keeps its Name", item(out, "Account").Name === "TRAHEEL DELIVERY SERVICES L.L.C");
}

console.log("\nThe accountant's contact carries the accountant's email");
{
  const out: any = withEpglRequestFields(renewal(), { accountantEmail: "accounts@traheel.ae" });
  const c = item(out, "NewContact");
  check("the borrowed address is corrected", c.Email === "accounts@traheel.ae", c.Email);
  check("...and the rest of the contact is left alone", c.LastName === "HALL" && c.EPG_Designation__c === "Accountant");
}
{
  // Nothing on the case: the model's value stands rather than being blanked.
  const out: any = withEpglRequestFields(renewal(), {});
  check("no accountant email on the case changes nothing", item(out, "NewContact").Email === "emre.karayalcin@7x.ae");
}
{
  const out: any = withEpglRequestFields(renewal(), { accountantEmail: "not-an-address" });
  check("an unusable value is ignored", item(out, "NewContact").Email === "emre.karayalcin@7x.ae");
}
{
  // Only the accountant. The applicant's own contact is matched on their own
  // address and must never be rewritten to someone else's.
  const input: any = renewal();
  input.body.compositeRequest[1].body.EPG_Designation__c = "Manager";
  const out: any = withEpglRequestFields(input, { accountantEmail: "accounts@traheel.ae" });
  check("a contact that is not the accountant is untouched", item(out, "NewContact").Email === "emre.karayalcin@7x.ae");
}

console.log("\nAnd the rollback explains itself");
const integrations = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
check("the message is recognised", /if \(\/same unique value\/i\.test\(res\.result\)\)/.test(integrations));
check("...it names the field EPGL named", /duplicate rule on the COMPANY NAME/.test(integrations));
check("...says nothing was created", /NOTHING WAS CREATED/.test(integrations));
check("...and that the customer is not at fault", /nothing the customer gave you is wrong/.test(integrations));
check("...forbids the retry that fails identically", /Do NOT retry the same payload/.test(integrations));
check("...and does not have them re-upload", /do NOT ask the customer to re-enter or re-upload anything/i.test(integrations));
check("...offers the update instead", /Offer to UPDATE the existing application instead/.test(integrations));
check("it is an error, so the model cannot read past it", /same unique value[\s\S]{0,400}isError: true/.test(integrations));
// The backend's own words are what the audit keeps.
check("...appended, never substituted", /result:\s*\n\s*res\.result \+\s*\n\s*`\\n\\nSUBMISSION ROLLED BACK/.test(integrations));

console.log("\nWhat their answers did NOT change");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
// "Yes it's possible, and the recommendedAction is just a recommendation."
check("the customer still decides new-vs-update", /duplicateDecision: \(\) => str\(session\.state\.data\.__duplicate_decision\) \?\? null/.test(route));
check("the accountant email is read from the case, not the composite", /accountantEmail: str\(liveState\.data\.accountant_email\)/.test(route));
// EPG_TRN_No__c is unique on their side and we have never sent it.
// Mentioned in a comment, never written into a payload.
check("EPG_TRN_No__c is still not sent anywhere",
  !/EPG_TRN_No__c\s*[:=]/.test(integrations) && /EPG_TRN_No__c should be unique too, which we have never sent/.test(integrations));

console.log("\nAnd it is written down for them");
const doc = readFileSync(new URL("../../../docs/EPGL-DUPLICATE-UNIQUE-FIELD-2026-09-24.md", import.meta.url), "utf8");
check("their answers are recorded", /## ANSWERED by EPGL, 29 September 2026/.test(doc));
check("...with what we changed", /### What we changed, 29 September/.test(doc));
check("...and our wrong guess kept rather than quietly deleted", /## Our reading at the time, which was wrong/.test(doc));
// The question that decides whether 24 September is actually fixed.
check("the open question is the one that matters", /A record is not its own duplicate/.test(doc));
// The doc hard-wraps, so the sentence is matched across the line break.
check("...and the contact-email risk is raised with them",
  /matching on email would overwrite the applicant's[\s\S]{0,40}record with the accountant's name/.test(doc));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
