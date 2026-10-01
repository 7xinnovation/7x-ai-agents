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

console.log("\nThe company name stays on the Account — reverted same day");
/**
 * For a few hours the Name was dropped whenever the Account carried an Id. The
 * reasoning looked sound — EPGL had just named the company-name duplicate rule
 * as the constraint, and a renewal does not rename a company — and the first
 * renewal through it, LR-37641, came back showing EMRE KARAYALCIN where TRAHEEL
 * DELIVERY SERVICES L.L.C belongs. Their handler does not leave an absent Name
 * alone, and the only other name in that composite is the applicant's.
 */
{
  const out: any = withEpglRequestFields(renewal(), { accountId: ACCOUNT_ID });
  const a = item(out, "Account");
  check("the company name is sent, Id or no Id", a.Name === "TRAHEEL DELIVERY SERVICES L.L.C", a);
  check("...and the Id it is addressed by stays", a.Id === ACCOUNT_ID);
  check("...the trade licence number stays", a.EPG_Trade_license_no__c === "1196781");
  check("...and its expiry stays", a.EPG_Trade_license_Expiry_date__c === "2027-06-07");
}
{
  const input: any = renewal();
  delete input.body.compositeRequest[0].body.Id;
  const out: any = withEpglRequestFields(input, {});
  check("a new application keeps its Name too", item(out, "Account").Name === "TRAHEEL DELIVERY SERVICES L.L.C");
}
// The guard against it coming back. Nothing in here may remove a company name.
{
  const src = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
  /**
   * The ACCOUNT's name. A Contact's `Name` is a different thing entirely — a
   * compound field Salesforce builds from FirstName and LastName, which cannot
   * be written and whose presence costs the whole composite a required Last
   * Name (1 October). That one is moved to LastName and removed, inside a
   * Contact-scoped loop, and this assertion must not catch it.
   */
  const contactBlock = src.slice(src.indexOf("A CONTACT HAS A LAST NAME"), src.indexOf("delete row.Name;") + 20);
  const elsewhere = src.replace(contactBlock, "");
  check("nothing deletes the Account's Name", !/delete b\.Name|delete row\.Name|Name: undefined/.test(elsewhere));
  check("...and why is written down where someone would try it again", /REVERTED SAME DAY \(2026-09-29\)/.test(src));
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

console.log("\nAnd a rolled-back composite is framed, not handed over raw");
const integrations = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
check("every rollback is caught, not just one message", /if \(\/Rolled back due to allOrNone\/i\.test\(res\.result\)\)/.test(integrations));
check("...says nothing was created", /SUBMISSION ROLLED BACK — NOTHING WAS CREATED/.test(integrations));
// The model told the customer the error was "on the Account item itself". With
// allOrNone it is on every item, which is exactly what it cannot conclude from.
check("...forbids naming which item failed", /do NOT know which item failed, and you must NOT tell the customer/.test(integrations));
check("...forbids inventing a cause", /DO NOT INVENT A CAUSE/.test(integrations));
// It resubmitted with the User item removed, of its own accord.
check("...forbids resubmitting with items removed", /DO NOT RESUBMIT WITH ITEMS REMOVED/.test(integrations));
check("...and does not blame the customer", /Nothing they did caused this/.test(integrations));
check("the company-name block is named for what it is", /duplicate-name check on the company/.test(integrations));
check("...as EPGL's, not the customer's to fix", /NOT something the customer can fix/.test(integrations));
check("...and never by changing the company name", /NOT a reason to alter the company name/.test(integrations));
check("a callback is offered there and not everywhere", /A callback is the right offer HERE, and only here/.test(integrations));
check("it is an error, so the model cannot read past it", /Rolled back due to allOrNone[\s\S]{0,2600}isError: true/.test(integrations));
check("...appended, never substituted", /result:\s*\n\s*res\.result \+\s*\n\s*`\\n\\nSUBMISSION ROLLED BACK/.test(integrations));

console.log("\nThe company is spelled differently on each object");
// EPG_Company__c is right on EPG_Partner__c and wrong on User and Contact. The
// model reaches for it on all three; the map corrects two of them.
check("User is corrected", /User: \{ EPG_Company__c: "EPG_Account__c" \}/.test(integrations));
check("Contact is corrected too", /Contact: \{ EPG_Company__c: "EPG_Account__c" \}/.test(integrations));
{
  const input: any = renewal();
  input.body.compositeRequest[1].body = { ...input.body.compositeRequest[1].body, EPG_Company__c: ACCOUNT_ID };
  delete input.body.compositeRequest[1].body.EPG_Account__c;
  const out: any = withEpglRequestFields(input, {});
  const c = item(out, "NewContact");
  check("the wrong name is renamed on the way out", c.EPG_Account__c === ACCOUNT_ID, c);
  check("...and the wrong one is gone", c.EPG_Company__c === undefined, c);
}
{
  // Partner keeps it: EPG_Company__c is correct there.
  const input: any = renewal();
  input.body.compositeRequest.push({
    method: "POST", referenceId: "Partner1",
    url: "/services/data/v66.0/sobjects/EPG_Partner__c",
    body: { EPG_Company__c: ACCOUNT_ID, EPG_Partner_Name__c: "Zain" },
  });
  const out: any = withEpglRequestFields(input, {});
  check("a partner's company field is left alone", item(out, "Partner1").EPG_Company__c === ACCOUNT_ID);
}

console.log("\nWhat their answers did NOT change");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
// "Yes it's possible, and the recommendedAction is just a recommendation."
check("the customer still decides new-vs-update", /duplicateDecision: \(\) => str\(session\.state\.data\.__duplicate_decision\) \?\? null/.test(route));
check("the accountant email is read from the case, not the composite", /accountantEmail: str\(liveState\.data\.accountant_email\)/.test(route));
// EPG_TRN_No__c is unique on their side and we have never sent it.
// EPG_TRN_No__c is unique on their side and we have never populated it — we do
// not collect a TRN anywhere in this journey.
check("EPG_TRN_No__c is still not sent anywhere", !/EPG_TRN_No__c/.test(integrations));
check("...and that gap is recorded for EPGL", /we do not collect a TRN anywhere in\s*\nthis journey/.test(
  readFileSync(new URL("../../../docs/EPGL-DUPLICATE-UNIQUE-FIELD-2026-09-24.md", import.meta.url), "utf8")));

console.log("\nA renewal goes to the account that holds the licence");
/**
 * Trade licence 1196781 matches THREE accounts in PreProd2: the licensed
 * company (postal licence 377), an inactive one (479), and a third with the
 * same Arabic and trade names and no licence at all. The renewal went to the
 * third. Everything after that followed from it — the composite asked to give
 * an unlicensed record the licensed company's name, EPGL's duplicate rule
 * refused it correctly, and we spent a day reporting their rule as broken.
 */
check("a multi-match latches the one holding a postal licence",
  /const licensed = found\.filter\(\(c\) => String\(c\.licenseRecordId \?\? ""\)\.trim\(\)\);\s*\n\s*if \(licensed\.length === 1\) rememberLicenceRecordId\(licensed\[0\]\);/.test(route));
check("...and says so, rather than leaving it to the card they tapped",
  /A RENEWAL IS ONLY POSSIBLE AGAINST THAT RECORD/.test(route));
check("...forbidding the model from supplying its own", /do not pass an accountId of your own for a renewal/.test(route));
check("...and from switching because a name reads better", /do not switch to another of these records because its name reads better/.test(route));
check("none licensed is not a renewal at all", /NONE of them holds a postal licence, so there is nothing here to renew/.test(route));
// Several licensed records is a real ambiguity and stays the customer's.
check("two licensed records are still the customer's choice to make",
  /licensed\.length === 1\s*\n?\s*\?/.test(route));

console.log("\nAnd a signed-in customer is not necessarily on the licensed record");
/**
 * The account a PERSON is attached to is not the account a LICENCE is attached
 * to. Emre signs in and is a Contact on 001FW00B34EmqMWYEZ, an unlicensed
 * duplicate; postal licence 377 lives on 0015f00000ic9okAAA. Every renewal that
 * afternoon went to the first, which is why the composite kept asking to give
 * an unlicensed record the licensed company's name.
 */
/**
 * WIDENED 1 OCTOBER. This required the lookup to be skipped whenever the
 * current record held a licenceRecordId — and that is exactly what broke it:
 * TWO accounts under this trade licence hold one, 377 (Active) and 479
 * (Inactive), so landing on the lapsed record meant keeping it. The lookup now
 * runs regardless and the ACTIVE rule decides. See
 * test-active-licence-latch-2026-10-01.
 */
check("the company is looked up again by trade licence",
  /const latchLicensedCompany = async \(/.test(route) && /if \(!c\) return "";\s*\n\s*const licence = String\(c\.tradeLicenseNumber/.test(route));
check("...and only where the pick is unambiguous and different",
  /if \(!pick \|\| pick\.accountId === c\.accountId\) return "";/.test(route));
check("...the licensed record becomes the target", /const licensed = \[pick\];\s*\n\s*rememberLicenceRecordId\(pick\);/.test(route));
check("...it is recorded", /action: "epgl_account_redirected_to_licensed"/.test(route));
check("...the model is told, and told not to alarm the customer", /do not describe this to the customer as a problem/.test(route));
check("a failed lookup leaves the latch alone", /A lookup that fails leaves the latch exactly as it was/.test(route));
check("the signed-in company tool uses it", /const redirect = await latchLicensedCompany\(found\);/.test(route));
check("...and the Emirates-ID lookup too", /const redirect = await latchLicensedCompany\(found\[0\]\);/.test(route));

console.log("\nA paid application is not resubmitted, and a rollback after one is not a failure");
/**
 * LR-37650. Submitted 11:22, paid 11:24, payment notification sent — and the
 * model then called the submit tool AGAIN in the update shape, which the
 * already-submitted guard lets through because an update is how a real
 * amendment is made. That one rolled back, and a customer who had just paid
 * AED 100,700 was told "EPGL's system is blocking the final filing step... this
 * needs EPGL to clear it manually", with a callback offered. Their renewal was
 * on file, approved and paid the whole time.
 */
check("a submit is refused once the case is submitted AND paid",
  /const paidAlready = typeof opts\.epglRequestFacts\?\.\(\)\.amountPaid === "number";/.test(integrations) &&
  /thisCasesRequest && paidAlready\) \{/.test(integrations));
check("...saying nothing is wrong rather than nothing was sent", /ALREADY SUBMITTED AND ALREADY PAID — NOTHING WAS SENT, and nothing is wrong/.test(integrations));
check("...and forbidding the callback outright", /Do NOT offer a callback for it, and do NOT arrange one/.test(integrations));
check("...while a real amendment is still possible, just not by resending", /do not re-send the application to do it/.test(integrations));
// And if one slips through anyway, the rollback must not read as a lost filing.
check("a rollback when a request already exists says so", /NOTHING WAS LOST AND NOTHING IS STUCK/.test(integrations));
check("...naming the reference already on file", /is ALREADY ON FILE with EPGL — this call was a second send/.test(integrations));
check("...and it is still audited as a failure", !/return res;\s*\n\s*\}\s*\n\s*const already/.test(integrations));

console.log("\nA designation their picklist refuses is dropped, not sent");
/**
 * EPGL sent the list on 29 September, after their own flow rolled a submission
 * back on INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST: "Applicant". A restricted
 * picklist fails the WHOLE composite under allOrNone, so one reasonable-looking
 * word loses every record in the submission. A contact with no designation is
 * recorded; a composite that rolls back is not.
 */
{
  const withDes = (v: string) => {
    const input: any = renewal();
    input.body.compositeRequest[1].body.EPG_Designation__c = v;
    return item(withEpglRequestFields(input, {}) as any, "NewContact").EPG_Designation__c;
  };
  check("Accountant is kept", withDes("Accountant") === "Accountant");
  check("...and every other value they listed", ["Manager", "Owner", "General Manager", "Finance Manager", "External Auditor", "Agent", "Sponsor", "Partner"].every((d) => withDes(d) === d));
  check("...case-insensitively, since the model writes prose", withDes("accountant") === "Accountant");
  // The exact value that rolled back a submission.
  check('"Applicant" is dropped rather than sent', withDes("Applicant") === undefined);
  check("...and so is anything else invented", withDes("Authorised Signatory") === undefined);
  // Multi-select: their own reads split on ";", so each part is judged alone.
  check("a multi-value keeps only what is allowed", withDes("Applicant;Accountant") === "Accountant");
  check("...and drops the field when none survives", withDes("Applicant;Signatory") === undefined);
  check("the allowed list is the one EPGL sent", /"External Auditor",/.test(integrations) && /"Finance Manager",/.test(integrations));
}

console.log("\nAnd which record it is, is settled before the model runs");
// Fixing the lookup paths was not enough: a turn that calls none of them still
// submits, carrying whatever account id the conversation was already holding.
check("the account is resolved from the trade licence at turn start",
  /const all = await companyByTradeLicense\(agent\.id, env, licenceNo\);/.test(route));
// The 15:03 attempt ran as new_license — a company EPGL already hold a record
// for, applying through the other journey — and a `journeyKey === "renewal"`
// gate skipped it. Which Account a submission is addressed to has nothing to do
// with which journey the conversation is in.
check("...for any EPGL journey, not just a renewal", /NOT GATED ON THE JOURNEY/.test(route) && !/=== "renewal"\) \{\s*\n\s*const licenceNo/.test(route));
check("...and the pick is made by one rule, used everywhere", /const pickLicensedCompany = /.test(route));
/**
 * Two of the three records hold a licence — 377 Active and 479 Inactive — so
 * "exactly one is licensed" was never true and the rule never acted. An
 * inactive licence is not the one being renewed.
 */
check("an ACTIVE licence decides first", /const active = licensed\.filter\(\(x\) => \/\^active\\b\/i\.test\(String\(x\.licenseStatus \?\? ""\)\.trim\(\)\)\);\s*\n\s*if \(active\.length === 1\) return active\[0\]!;/.test(route));
check("...then a single licensed record", /if \(licensed\.length === 1\) return licensed\[0\]!;/.test(route));
check("...and two live licences stay the customer's ambiguity", /return null;\s*\n\s*\};/.test(route));
check("...and it is recorded when there was a choice to make", /action: "epgl_account_resolved_at_turn_start"/.test(route));
check("a failed lookup changes nothing", /A lookup that fails leaves the turn exactly as it was/.test(route));
// Several lookups run per turn and they disagree; last-write-wins is what put a
// renewal on an unlicensed record three times in one afternoon.
check("an unlicensed record cannot replace a licensed one",
  /if \(!id && epglLicenceRecordId\.value\) return; \/\/ do not downgrade/.test(route));

console.log("\nAnd it is written down for them");
const doc = readFileSync(new URL("../../../docs/EPGL-DUPLICATE-UNIQUE-FIELD-2026-09-24.md", import.meta.url), "utf8");
check("their answers are recorded", /## ANSWERED by EPGL, 29 September 2026/.test(doc));
{
  // The report that blamed their duplicate rule is withdrawn IN PLACE, with the
  // payloads left standing — a correction nobody can find is not a correction.
  const payloadDoc = readFileSync(new URL("../../../docs/EPGL-COMPANY-NAME-DUPLICATE-2026-09-29.md", import.meta.url), "utf8");
  check("the wrong conclusion is withdrawn at the top", /## WITHDRAWN — the fault was ours/.test(payloadDoc));
  check("...naming the three accounts", /001FW00B34EmqMWYEZ/.test(payloadDoc) && /0015f00000ic9okAAA/.test(payloadDoc));
  check("...and saying their check is correct", /your check is\s*\nbehaving correctly/.test(payloadDoc));
  check("...without deleting what we sent them", /Kept here because it is what we sent you/.test(payloadDoc));
  check("the rename is owned rather than reported as theirs", /the third record's name is our doing/i.test(payloadDoc));
}
check("...with what we changed", /### What we changed, 29 September/.test(doc));
check("...and our wrong guess kept rather than quietly deleted", /## Our reading at the time, which was wrong/.test(doc));
// The question that decides whether 24 September is actually fixed.
check("the open question is the one that matters", /A record is not its own duplicate/.test(doc));
// The doc hard-wraps, so the sentence is matched across the line break.
check("...and the contact-email risk is raised with them",
  /matching on email would overwrite the applicant's[\s\S]{0,40}record with the accountant's name/.test(doc));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
