/**
 * Four defects from one human run of EPGL 2.0 (4 November 2026, LR-54109).
 *
 *  1. A SECOND application. LR-54109 was created at 09:32 and paid at 09:34;
 *     at 09:35 the model called the create again and Salesforce made LR-54401.
 *     The only guard was keyed on the 1.x tool and the 1.x reference.
 *  2. LR-37795 shown again. The mask of 3 November read the duplicate check's
 *     fields at the top level; they arrive inside `body`, so it never armed.
 *  3. The whole application rolled back, because the MODEL wrote an undated
 *     SME licence into the create and only our own items were kept dated.
 *  4. The lease called "optional", because the prompt printed the word
 *     `conditional` and the model guessed.
 *
 * Every fixture here is a shape taken from that run's logs — the previous
 * round of tests used flat objects the runtime never produces, and passed.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-20-run-defects-2026-11-04.ts
 */
import { readFileSync } from "node:fs";
import { createsApplication, withDatedDocuments, type EpglCaseFile } from "@/lib/epglComposite";
import { isTwoZeroDuplicateCheck, maskForeignApplicationRefs } from "@/lib/epglCrossOrg";
import { requirementText } from "@dialog/core";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

const item = (sobject: string, referenceId: string, body: Record<string, unknown>, method = "POST") =>
  ({ method, url: `/services/data/v60.0/sobjects/${sobject}`, referenceId, body });

/** The 09:35:04 create, as logged: Account, Contact, licence request, documents. */
const SECOND_CREATE = {
  body: {
    allOrNone: true,
    compositeRequest: [
      item("Account", "NewAccount", { RecordType: "Licensed_Customer", Name: "7X TEST - DO NOT PROCESS - 20261022A" }),
      item("Contact", "NewContact", { AccountId: "@{NewAccount.id}" }),
      item("EPG_License_Request__c", "NewLicenseRequest", { Product_Code: "CEP30-UAE-SME-DOM" }),
      item("EPG_Document__c", "Doc1", { Document_Type: "SME Licence (federal or local government)" }),
    ],
  },
};
/** The 09:33:03 follow-up, as logged: documents only, against the application. */
const FOLLOW_UP = {
  body: {
    allOrNone: false,
    compositeRequest: [item("EPG_Document__c", "Doc1", { applicationId__c: "LR-54109", Document_Type: "SME Licence (federal or local government)" })],
  },
};

console.log("\n1 · one application per conversation");
check("the 09:35 create IS a create", createsApplication(SECOND_CREATE));
check("the document follow-up is not", !createsApplication(FOLLOW_UP));
check("an amendment by Id is not",
  !createsApplication({ body: { compositeRequest: [item("EPG_License_Request__c", "R", { Id: "a11FW000x" }, "PATCH")] } }));
check("...nor by Name", !createsApplication({ body: { compositeRequest: [item("EPG_License_Request__c", "R", { Name: "LR-54109" })] } }));
check("no body at all is not", !createsApplication(undefined));
const intg = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
check("the guard refuses a create when the case already has an application",
  /const existing = opts\.epglApplicationId\?\.\(\) \?\? null;\s*\n\s*if \(existing && createsApplication\(input\)\)/.test(intg));
check("...and says the documents go to the existing one", /are sent to \$\{existing\} automatically/.test(intg));
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
check("the route hands it the in-turn application id, so a create earlier this turn counts",
  /epglApplicationId: agent\.definition\.tenantSlug === "epgl" \? \(\) => epglApplication\.id \|\| null : undefined/.test(route));

console.log("\n2 · the duplicate check's references, with the input as it really arrives");
const AS_LOGGED = { body: { productCode: "CEP30-UAE-SME-DOM", tradeLicenseNumber: "CN-1234567" } };
check("the 09:30 call is recognised as 2.0", isTwoZeroDuplicateCheck(AS_LOGGED));
check("a 1.x call in the same wrapper is still 1.x",
  !isTwoZeroDuplicateCheck({ body: { tradeLicenseNumber: "1196781", postalLicenseNumber: "377", serviceId: "S-EPG-000003" } }));
check("a flat call is still understood", isTwoZeroDuplicateCheck({ productCode: "LOCKERS" }));
const RES = '{"matchFound":true,"matchedRequests":[{"recommendedAction":"Update existing application","matchedRequestStatus":"Under document review","matchedRequestNumber":"LR-37795"}],"matchedRecordIds":["001FW00GHRYBSBYY25"]}';
check("...and the response it gets then carries no LR-37795", !maskForeignApplicationRefs(RES).result.includes("LR-37795"));

console.log("\n3 · an undated document the model wrote cannot roll back the application");
const file = (key: string, salesforceType: string, validityRequired: boolean, validTo?: string): EpglCaseFile =>
  ({ key, fileName: `${key}.pdf`, bytes: new Uint8Array([1]), salesforceType, validityRequired, validTo });
const FILES = [
  file("sme_licence_federal_or_local_government", "SME Licence (federal or local government)", true),
  file("beneficial_ownership_declaration", "Beneficial Ownership Declaration", false),
  file("lease_contract", "Lease Contract", true, "2027-12-31"),
];
const FIRST_CREATE = {
  body: {
    allOrNone: true,
    compositeRequest: [
      item("EPG_License_Request__c", "NewLicenseRequest", {}),
      item("EPG_Document__c", "Doc1", { Document_Type: "SME Licence (federal or local government)" }),
      item("EPG_Document__c", "Doc2", { Document_Type: "Beneficial Ownership Declaration" }),
      item("EPG_Document__c", "Doc3", { Document_Type: "Lease Contract" }),
    ],
  },
};
const d = withDatedDocuments(FIRST_CREATE, FILES);
const types = (((d.input as any).body.compositeRequest) as any[]).map((i) => i.body.Document_Type).filter(Boolean);
check("the undated SME licence comes off the create", d.withheld.join() === "sme_licence_federal_or_local_government", d);
check("...so it cannot roll the application back", !types.includes("SME Licence (federal or local government)"), types);
check("a slot with a date on the case gets that date", d.dated.join() === "lease_contract", d.dated);
check("...written onto the item",
  ((d.input as any).body.compositeRequest as any[]).find((i: any) => i.body.Document_Type === "Lease Contract")?.body.Valid_To__c === "2027-12-31");
check("a document that needs no date is untouched", types.includes("Beneficial Ownership Declaration"));
check("the application itself stays", ((d.input as any).body.compositeRequest as any[]).some((i: any) => /License_Request/.test(i.url)));
check("a date the model supplied is kept as it is", withDatedDocuments({
  body: { allOrNone: true, compositeRequest: [item("EPG_Document__c", "D", { Document_Type: "SME Licence (federal or local government)", Valid_To__c: "2028-01-01" })] },
}, FILES).withheld.length === 0);
check("the follow-up call is left alone — a refusal there costs one slot", withDatedDocuments(FOLLOW_UP, FILES).input === FOLLOW_UP);

console.log("\n4 · what 'conditional' means, said plainly");
const lease = requirementText({ requirement: "conditional", condition: "product_family == 'CEP30'" });
check("a conditional document is described as required when its condition holds", /REQUIRED when product_family == 'CEP30'/.test(lease), lease);
check("...and explicitly not optional", /not optional/.test(lease), lease);
check("mandatory prints exactly as before", requirementText({ requirement: "mandatory", condition: "partner_count >= 2" }) === "mandatory");
check("optional prints exactly as before", requirementText({ requirement: "optional" }) === "optional");
check("a conditional with no condition stays the plain word", requirementText({ requirement: "conditional" }) === "conditional");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
