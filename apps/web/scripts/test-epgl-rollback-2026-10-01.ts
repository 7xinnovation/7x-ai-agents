/**
 * Three faults in one rollback, two of them ours (2026-10-01).
 *
 * A renewal was refused and the customer was told:
 *
 *   "EPGL's system is blocking this submission on the company record. This is a
 *   known issue on their side... I'd like to arrange a callback."
 *
 * The response actually said three things, joined with " | ":
 *
 *   A company with the same name already exists.
 * | ...INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST: Designation: bad value for
 *   restricted picklist field: Applicant
 * | A required field value is missing: "Last Name".
 *
 * The second came from the USER item, which carried EPG_Designation__c
 * "Applicant" — the picklist guard was scoped to Contacts, so it filtered the
 * copy their flow makes and not the source. The third came from the
 * accountant's Contact being sent as {"Name": "..."}; on a Contact, Name is a
 * compound field that cannot be written and LastName is required.
 *
 * Both were ours. The customer was sent to wait for a callback that could not
 * have helped.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-rollback-2026-10-01.ts
 */
import { readFileSync } from "node:fs";
import { withEpglRequestFields } from "../lib/integrations";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const src = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");

console.log("\nThe designation guard follows the FIELD, not one object");
check("no Contact-only scope on it", /for \(const item of items\) \{\s*\n\s*for \(const row of \(Array\.isArray\(item\.body\)[\s\S]{0,200}EPG_Designation__c === undefined\) continue;/.test(src));
check("...a value off the list is dropped, not sent", /else delete row\.EPG_Designation__c;/.test(src));
// Applicant is the obvious word for the person applying and is not on their
// list. A contact with no designation is recorded; a composite that rolls back
// is not.
check("...and Applicant is still not on the list", !/"Applicant",/.test(src.slice(src.indexOf("const DESIGNATIONS = ["), src.indexOf("const designation ="))));

console.log("\nA Contact has a last name, not a name");
check("Name moves to LastName", /if \(!String\(row\.LastName \?\? ""\)\.trim\(\) && name\) row\.LastName = name;/.test(src));
check("...and Name is removed either way", /delete row\.Name;/.test(src));
// An accountant is often a firm, so there is no first name to split off and
// inventing one would put a surname on a company.
check("...the whole name kept, never split", !/split\(" "\)[\s\S]{0,40}LastName/.test(src));
{
  // Account, Members__c and EPG_Partner__c all have a writable Name and must
  // keep it; only a Contact's is the compound field that cannot be written.
  const block = src.slice(src.indexOf("A CONTACT HAS A LAST NAME"), src.indexOf("delete row.Name;"));
  check("...only on Contacts", /sobjects\\\/Contact\$/.test(block));
}

console.log("\nThe payload from 1 October, put back through it");
{
  /** The three items that mattered, exactly as they were sent and refused. */
  const sent = {
    body: {
      allOrNone: true,
      compositeRequest: [
        {
          url: "/services/data/v66.0/sobjects/Account",
          referenceId: "Account",
          method: "POST",
          body: { Id: "001FW00B34EmqMWYEZ", Name: "TRAHEEL DELIVERY SERVICES L.L.C", EPG_Trade_license_no__c: "1196781" },
        },
        {
          url: "/services/data/v66.0/sobjects/User",
          referenceId: "NewUser",
          method: "POST",
          body: { Email: "a@b.c", LastName: "KARAYALCIN", FirstName: "EMRE", EPG_Designation__c: "Applicant" },
        },
        {
          url: "/services/data/v66.0/sobjects/Contact",
          referenceId: "NewContact",
          method: "POST",
          body: { Name: "M B C Auditing & Accounting", Email: "x@y.z", EPG_Designation__c: "Accountant" },
        },
      ],
    },
  };
  const out = withEpglRequestFields(sent as never, {}) as unknown as {
    body: { compositeRequest: { referenceId: string; body: Record<string, unknown> }[] };
  };
  const item = (ref: string) => out.body.compositeRequest.find((c) => c.referenceId === ref)!.body;

  check("the User loses the designation their picklist refuses", item("NewUser").EPG_Designation__c === undefined, item("NewUser"));
  check("...and keeps everything else", item("NewUser").LastName === "KARAYALCIN" && item("NewUser").FirstName === "EMRE");
  check("the Contact gains a Last Name", item("NewContact").LastName === "M B C Auditing & Accounting", item("NewContact"));
  check("...and loses the one that cannot be written", item("NewContact").Name === undefined);
  // Accountant IS on their list and must survive.
  check("...keeping a designation that is on the list", item("NewContact").EPG_Designation__c === "Accountant");
  // The regression from 29 September, which cost a company its name on LR-37641.
  check("the Account keeps its name", item("Account").Name === "TRAHEEL DELIVERY SERVICES L.L.C");
}

console.log("\nAnd EPGL are only blamed when the message blames nobody else");
check("the duplicate story needs to be the only one", /const dupOnly = \/company with the same name already exists\/i\.test\(errorText\) && !\/\\s\\\|\\s\/\.test\(errorText\);/.test(src));
check("...driving the callback branch", /const dup = dupOnly;/.test(src));
// The generic branch says what the message says and offers no callback.
check("...otherwise the message speaks for itself", /if the message names something concrete, say that plainly/.test(src));

console.log("\nThe guardrails that were already right, kept");
check("no cause is invented", /DO NOT INVENT A CAUSE/.test(src));
check("items are never dropped to get past it", /DO NOT RESUBMIT WITH ITEMS REMOVED/.test(src));
check("...and a request already on file is not reported as lost", /NOTHING WAS LOST AND NOTHING IS STUCK/.test(src));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
