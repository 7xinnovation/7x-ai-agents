/**
 * The field names Salesforce actually has — checked against the payload that
 * went out as LR-37214, which is the submission they reviewed.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-field-names-2026-09-08.ts
 */
import { withEpglFieldNames, postalActivityCodes, POSTAL_ACTIVITIES } from "../lib/epglFields";
import { withEpglRequestFields } from "../lib/integrations";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const item = (url: string, body: unknown, referenceId = "R") => ({
  method: "POST", referenceId, url: `/services/data/v66.0/sobjects/${url}`, body,
});
const wrap = (items: unknown[]) => ({ body: { allOrNone: true, isAgentSource: true, compositeRequest: items } });
const outOf = (input: unknown, ref: string) => {
  const items = ((input as any).body.compositeRequest as any[]);
  return items.find((i) => i.referenceId === ref)?.body;
};

console.log("\nEPG_Partner__c");
{
  const r = withEpglFieldNames(wrap([
    item("Account", { Name: "ACME" }, "NewAccount"),
    item("EPG_Partner__c", {
      Name: "Faisal Eissa Lutfi Ali Hussain",
      EPG_Account__c: "@{NewAccount.id}",
      EPG_Emirates_Id__c: "784-1984-0847950-3",
      EPG_Nationality__c: "United Arab Emirates",
    }, "NewPartner1"),
  ]));
  const p = outOf(r, "NewPartner1");
  check("EPG_Account__c becomes EPG_Company__c", p.EPG_Company__c === "@{NewAccount.id}", p);
  check("the wrong name is gone", p.EPG_Account__c === undefined, p);
  check("EPG_Emirates_Id__c becomes EPG_Emirates_ID__c", p.EPG_Emirates_ID__c === "784-1984-0847950-3", p);
  check("the lowercase spelling is gone", p.EPG_Emirates_Id__c === undefined, p);
  check("everything else is untouched", p.EPG_Nationality__c === "United Arab Emirates" && p.Name.startsWith("Faisal"), p);
}
{
  // Casing is the whole point: their matching keys on the capitalised name, so
  // getting it wrong duplicates the partner rather than failing loudly.
  const r = withEpglFieldNames(wrap([item("EPG_Partner__c", { Name: "A", EPG_Emirates_ID__c: "784", EPG_Emirates_Id__c: "ignored" }, "P")]));
  check("a value already correctly named wins", outOf(r, "P").EPG_Emirates_ID__c === "784", outOf(r, "P"));
}

console.log("\nUser — the SAME spelling, and correct there");
{
  const r = withEpglFieldNames(wrap([item("User", { Email: "a@b.c", LastName: "K", EPG_Emirates_Id__c: "784-1984-0847950-3" }, "NewUser")]));
  const u = outOf(r, "NewUser");
  check("User keeps EPG_Emirates_Id__c", u.EPG_Emirates_Id__c === "784-1984-0847950-3", u);
  check("User is not given the partner spelling", u.EPG_Emirates_ID__c === undefined, u);
}

console.log("\nMembers__c");
{
  const r = withEpglFieldNames(wrap([
    item("Members__c", {
      Name: "Mohammed Ali",
      EPG_Account__c: "@{NewAccount.id}",
      EPG_Contact__c: "@{NewContact.id}",
      EPG_Designation__c: "Manager",
    }, "NewMember"),
  ]));
  const m = outOf(r, "NewMember");
  check("EPG_Account__c becomes AccountId__c", m.AccountId__c === "@{NewAccount.id}", m);
  check("EPG_Contact__c is dropped", m.EPG_Contact__c === undefined, m);
  check("EPG_Designation__c is dropped", m.EPG_Designation__c === undefined, m);
  check("the name survives", m.Name === "Mohammed Ali", m);
}
{
  // LR-37214's member had no name at all, which is what files it as "Unknown Member".
  const r = withEpglFieldNames(wrap([
    item("Account", { Name: "ACME" }, "NewAccount"),
    item("Members__c", { EPG_Account__c: "@{NewAccount.id}", EPG_Contact__c: "@{NewContact.id}" }, "NewMember"),
  ]));
  const items = (r as any).body.compositeRequest;
  check("a nameless member is dropped, not filed as Unknown Member", items.length === 1 && items[0].referenceId === "NewAccount", items.map((i: any) => i.referenceId));
}
{
  const r = withEpglFieldNames(wrap([item("Members__c", [{ Name: "A", EPG_Account__c: "x" }, { EPG_Account__c: "x" }], "M")]));
  const rows = outOf(r, "M");
  check("array bodies keep only the named rows", rows.length === 1 && rows[0].AccountId__c === "x", rows);
}

console.log("\nEPG_License_Request__c");
{
  // Exactly the licence-request body from LR-37214.
  const r = withEpglFieldNames(wrap([
    item("EPG_License_Request__c", {
      serviceId: "S-EPG-000002",
      RecordTypeId: "0125f000001xIhuAAE",
      EPG_Region__c: "Al Mankhool",
      serviceNameEN: "Issue Postal Activity License",
      EPG_Account__c: "@{NewAccount.id}",
      EPG_Service__c: "a1H5f0000033Q7pEAE",
      EPG_Emirates__c: "Dubai",
      EPG_Amount_Paid__c: 1010,
      EPG_Activity_Codes__c: "Letters & Post Items Delivery, Parcels Delivery",
      Terms_Conditions_Accepted__c: true,
    }, "NewLicenseRequest"),
  ]));
  const l = outOf(r, "NewLicenseRequest");
  check("serviceId gains its __c", l.serviceId__c === "S-EPG-000002" && l.serviceId === undefined, l);
  // Capital S: their spec says serviceNameEN__c, the org says ServiceNameEN__c.
  // Salesforce writes are case-insensitive so both land, but we send the real one.
  check("serviceNameEN becomes ServiceNameEN__c", l.ServiceNameEN__c === "Issue Postal Activity License" && l.serviceNameEN === undefined, l);
  check("EPG_Activity_Codes__c becomes Activity_Codes__c", l.Activity_Codes__c !== undefined && l.EPG_Activity_Codes__c === undefined, l);
  check("Terms_Conditions_Accepted__c becomes EPG_Terms_and_Conditions__c", l.EPG_Terms_and_Conditions__c === true && l.Terms_Conditions_Accepted__c === undefined, l);
  check("EPG_Emirates__c becomes EPG_Current_Emirate__c", l.EPG_Current_Emirate__c === "Dubai" && l.EPG_Emirates__c === undefined, l);
  check("EPG_Region__c becomes EPG_Current_Region__c", l.EPG_Current_Region__c === "Al Mankhool" && l.EPG_Region__c === undefined, l);
  check("EPG_Account__c is left alone — it is right on this object", l.EPG_Account__c === "@{NewAccount.id}", l);
  check("the amount paid is left alone", l.EPG_Amount_Paid__c === 1010, l);
}
{
  // The Account's own emirate must NOT be renamed: only the licence request's.
  const r = withEpglFieldNames(wrap([item("Account", { Name: "ACME", EPG_Emirates__c: "Dubai", EPG_Region__c: "Al Mankhool" }, "NewAccount")]));
  const a = outOf(r, "NewAccount");
  check("the Account keeps EPG_Emirates__c", a.EPG_Emirates__c === "Dubai", a);
  check("the Account keeps EPG_Region__c", a.EPG_Region__c === "Al Mankhool", a);
}

console.log("\nActivity codes — numeric, or nothing");
check("letters", postalActivityCodes("Letters & Post Items Delivery") === "5320002", postalActivityCodes("Letters & Post Items Delivery"));
check("documents", postalActivityCodes("Documents Delivery") === "5320007", postalActivityCodes("Documents Delivery"));
check("parcels", postalActivityCodes("Parcels Delivery") === "5320009", postalActivityCodes("Parcels Delivery"));
check("two of them, comma separated", postalActivityCodes("Letters and Parcels") === "5320002,5320009", postalActivityCodes("Letters and Parcels"));
check("all three keep their listed order", postalActivityCodes("parcels, documents, letters") === "5320002,5320007,5320009", postalActivityCodes("parcels, documents, letters"));
check("numeric input passes through", postalActivityCodes("5320002,5320009") === "5320002,5320009", postalActivityCodes("5320002,5320009"));
check("a code we do not accept is not echoed", postalActivityCodes("5320099") === null, postalActivityCodes("5320099"));
check("Arabic parcels", postalActivityCodes("توصيل طرود") === "5320009", postalActivityCodes("توصيل طرود"));
check("Arabic documents", postalActivityCodes("توصيل مستندات") === "5320007", postalActivityCodes("توصيل مستندات"));
check("LR-37214's actual value maps to nothing", postalActivityCodes("Coffee Shop, Restaurant") === null, postalActivityCodes("Coffee Shop, Restaurant"));
check("empty is nothing", postalActivityCodes("") === null && postalActivityCodes(undefined) === null);
check("three activities are on the list", POSTAL_ACTIVITIES.length === 3);
{
  const r = withEpglFieldNames(wrap([item("EPG_License_Request__c", { Activity_Codes__c: "Coffee Shop, Restaurant" }, "L")]));
  check("unrecognised activities are omitted, not sent as prose", outOf(r, "L").Activity_Codes__c === undefined, outOf(r, "L"));
}

console.log("\nwithEpglRequestFields writes the corrected names");
{
  const filled = withEpglRequestFields(wrap([item("EPG_License_Request__c", { RecordTypeId: "x" }, "L"), item("Account", { Name: "A" }, "NewAccount")]), {
    emirate: "Dubai", region: "Al Mankhool", activityCodes: "Letters, Parcels",
    regulator: "Department of Economic Development", termsAccepted: true,
    amountPaid: 1010, paymentReference: "d12ddb6c",
  });
  const l = outOf(filled, "L");
  check("emirate lands on EPG_Current_Emirate__c", l.EPG_Current_Emirate__c === "Dubai", l);
  check("region lands on EPG_Current_Region__c", l.EPG_Current_Region__c === "Al Mankhool", l);
  check("activities land numerically", l.Activity_Codes__c === "5320002,5320009", l);
  check("terms land on EPG_Terms_and_Conditions__c", l.EPG_Terms_and_Conditions__c === true, l);
  check("the old names are not written at all", l.EPG_Emirates__c === undefined && l.EPG_Region__c === undefined && l.Terms_Conditions_Accepted__c === undefined, l);
  check("the Account still gets its own emirate", outOf(filled, "NewAccount").EPG_Emirates__c === "Dubai", outOf(filled, "NewAccount"));
}

console.log("\nShape is preserved");
{
  const before = wrap([item("Account", { Name: "A" }, "NewAccount"), item("EPG_Partner__c", { Name: "P", EPG_Account__c: "x" }, "NewPartner1")]);
  const after = withEpglFieldNames(before) as any;
  check("allOrNone survives", after.body.allOrNone === true, after.body.allOrNone);
  check("isAgentSource survives", after.body.isAgentSource === true, after.body.isAgentSource);
  check("method and url survive", after.body.compositeRequest[1].method === "POST" && after.body.compositeRequest[1].url.endsWith("/EPG_Partner__c"), after.body.compositeRequest[1]);
  check("the input is not mutated", (before.body.compositeRequest[1] as any).body.EPG_Account__c === "x");
  check("a payload with no compositeRequest is returned as-is", withEpglFieldNames({ body: { foo: 1 } } as any)?.body !== undefined);
  check("undefined survives", withEpglFieldNames(undefined) === undefined);
}

console.log("\nContact — secondary contacts, and only those");
// Their swagger says it in one word each: Contact is "Secondary contacts",
// User is "Portal applicant". Their handler stamps the designation itself --
// Primary on the Contact it builds from NewUser, Secondary on ours -- and both
// flags are read-only to our integration user anyway. So we state nothing that
// contradicts it, and never send the applicant twice.
{
  const r = withEpglFieldNames(wrap([
    item("Contact", { Email: "a@b.c", LastName: "K", FirstName: "E", AccountId: "@{NewAccount.id}" }, "NewContact"),
  ]));
  const c = outOf(r, "NewContact");
  check("a contact is marked secondary, which is what the object is for", c.Is_Secondary_Contact__c === "True", c);
  check("...as the STRING their enum declares, not a boolean", typeof c.Is_Secondary_Contact__c === "string", typeof c.Is_Secondary_Contact__c);
  check("we no longer claim it is primary — their handler decides that", c.Is_Primary_Contact__c === undefined, c);
  check("everything else is untouched", c.Email === "a@b.c" && c.AccountId === "@{NewAccount.id}", c);
}
{
  // Their pre-9-Sep swagger named a field that does not exist on the object,
  // confirmed by a describe against their own sandbox. It goes, whatever value
  // it arrived with, and the real name takes its place.
  const r = withEpglFieldNames(wrap([item("Contact", { LastName: "K", Secondary_Contact: "True" }, "C")]));
  check("the old Secondary_Contact is dropped", outOf(r, "C").Secondary_Contact === undefined, outOf(r, "C"));
  check("...and the corrected name carries the value", outOf(r, "C").Is_Secondary_Contact__c === "True", outOf(r, "C"));
}
{
  // A boolean is the natural thing for a model to send for a field whose label
  // reads like a checkbox. Their enum is strings.
  const t = withEpglFieldNames(wrap([item("Contact", { LastName: "K", Is_Secondary_Contact__c: true }, "C")]));
  check("a boolean true becomes 'True'", outOf(t, "C").Is_Secondary_Contact__c === "True", outOf(t, "C"));
  const f = withEpglFieldNames(wrap([item("Contact", { LastName: "K", Is_Secondary_Contact__c: false }, "C")]));
  check("a boolean false becomes 'False'", outOf(f, "C").Is_Secondary_Contact__c === "False", outOf(f, "C"));
  const s2 = withEpglFieldNames(wrap([item("Contact", { LastName: "K", Is_Secondary_Contact__c: "false" }, "C")]));
  check("a lower-case string is normalised too", outOf(s2, "C").Is_Secondary_Contact__c === "False", outOf(s2, "C"));
}
{
  // The 9 September blocker, reproduced. The applicant already has a PRIMARY
  // Contact from a previous submission, matched on Email; sending them again as
  // NewContact asks Salesforce to mark that same record Secondary as well, and
  // the validation rule refuses. The applicant belongs in NewUser only.
  const r = withEpglFieldNames(wrap([
    item("Contact", { Email: "Emre.Karayalcin@7x.ae", LastName: "Karayalcin" }, "NewContact"),
    item("User", { Email: "emre.karayalcin@7x.ae", FirstName: "Emre", LastName: "Karayalcin" }, "NewUser"),
  ]));
  const ids = (r!.body as any).compositeRequest.map((i: any) => i.referenceId);
  check("the applicant is not also sent as a secondary contact", !ids.includes("NewContact"), ids);
  check("...and the applicant themselves still goes", ids.includes("NewUser"), ids);
}
{
  // A genuinely different person is exactly what the object is for, and stays.
  const r = withEpglFieldNames(wrap([
    item("Contact", { Email: "ops@company.ae", LastName: "Mintah" }, "NewContact"),
    item("User", { Email: "emre.karayalcin@7x.ae", LastName: "Karayalcin" }, "NewUser"),
  ]));
  const c = outOf(r, "NewContact");
  check("a real secondary contact survives", c && c.Email === "ops@company.ae", c);
  check("...marked secondary", c.Is_Secondary_Contact__c === "True", c);
}
{
  // One row of an array-bodied Contact can collide while the others do not.
  const r = withEpglFieldNames(wrap([
    item("Contact", [{ Email: "ops@company.ae", LastName: "A" }, { Email: "me@7x.ae", LastName: "B" }], "C"),
    item("User", { Email: "me@7x.ae", LastName: "B" }, "NewUser"),
  ]));
  const rows = outOf(r, "C");
  check("only the colliding row is dropped", rows.length === 1 && rows[0].Email === "ops@company.ae", rows);
}
{
  // With no NewUser there is nothing to collide with, and the contact stands.
  const r = withEpglFieldNames(wrap([item("Contact", { Email: "solo@company.ae", LastName: "S" }, "C")]));
  check("a lone contact is kept", outOf(r, "C").Email === "solo@company.ae", outOf(r, "C"));
}
{
  // The flag belongs to Contact. Putting it on the Account is what the model
  // tried when the rolled-back error was echoed onto every item.
  const r = withEpglFieldNames(wrap([item("Account", { Name: "ACME" }, "NewAccount")]));
  const a = outOf(r, "NewAccount");
  check("the Account does not get a contact flag", a.Is_Primary_Contact__c === undefined && a.Is_Secondary_Contact__c === undefined, a);
  const p = withEpglFieldNames(wrap([item("EPG_Partner__c", { Name: "P" }, "P")]));
  const q = outOf(p, "P");
  check("nor does a partner", q.Is_Primary_Contact__c === undefined && q.Is_Secondary_Contact__c === undefined, q);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
