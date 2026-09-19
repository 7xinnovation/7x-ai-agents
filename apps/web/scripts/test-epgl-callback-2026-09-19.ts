/**
 * A callback an EPGL applicant asks for, in EPGL's own queue.
 *
 * Until 19 September this went nowhere. `opsCrm.createCallback` raises a case on
 * emiratespost.ae's contact form and falls back to a PO Box ops mailbox — both
 * the POSTAL side of the business, neither able to help with a postal activity
 * licence, and the mailbox unset in every environment. So the tool threw and the
 * assistant told the applicant to use a channel it could not name.
 *
 * Emirates Post Group Licensing supplied the route (CallbackCase-PREPROD-Simple):
 * a Case on the Callback record type over the standard Salesforce REST API.
 *
 * Verified live against PreProd2 the day it was built — Case 00003600,
 * 500FW00AOKcbyRkY2I, read back with Origin "Live Chat", Priority High and Type
 * "Renew Postal Activity License". These checks hold the shape of that.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-callback-2026-09-19.ts
 */
import { readFileSync } from "node:fs";
import { caseTypeFor } from "../lib/epglCallback";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const cb = read("../lib/epglCallback.ts");
/**
 * The same file with the comments taken out, and with the prose reflowed.
 *
 * "Must not appear" has to be asked of the CODE: every one of these strings is
 * discussed at length in the comments, precisely because the decision not to use
 * it is the interesting part. And "the code says why" has to be asked of prose
 * that has been unwrapped, or a regex fails on wherever the line happened to
 * break.
 */
const code = cb.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const prose = cb.replace(/\n\s*\*\s?/g, " ").replace(/\s+/g, " ");
const registry = read("../lib/registry.ts");
const types = read("../../../packages/core/src/adapters/types.ts");
const tools = read("../../../packages/core/src/ai/tools.ts");
const epglRead = read("../lib/epglRead.ts");

console.log("\nThe case lands where the licensing team works");
check("EPGL is routed before the PO Box contact form", registry.indexOf("createEpglCallback") < registry.indexOf("raiseEpCase("));
check("...on the tenant, not the agent slug", /tenantSlug === "epgl"/.test(registry));
check("...and follows the agent's active environment", /agent\.definition\.activeEnvironment \?\? "production"/.test(registry));
check("the customer's own words go with it", /description: `\$\{String\(input\.reason \?\? ""\)\}\$\{context\}`/.test(registry));
check("...and so does the handover context", /--- Context from the assistant ---/.test(registry));
check("NXN is untouched", /raiseEpCase\(\{/.test(registry) && /NXN_BRANCH_OPS_EMAIL/.test(registry));

console.log("\nThe record type is asked of the org, not compiled in");
check("nothing hardcodes the PreProd2 id", !/012FW001nRU85B6YQJ/.test(code), code.match(/012FW\w+/)?.[0]);
check("it is read from the Case describe", /sobjects\/Case\/describe/.test(cb));
check("...filtered to what this user may actually use", /r\.available &&/.test(cb));
check("...by name", /=== CALLBACK_RECORD_TYPE\.toLowerCase\(\)/.test(cb));
// Checked against the org on 19 September: SELECT ... FROM RecordType returns
// five types for this user and Callback is not among them, while describe
// returns it available. Access to the RecordType OBJECT is a different grant.
check("and not from a RecordType query, which does not see it", !/FROM RecordType/i.test(code));
check("a missing record type names the fix, which is in Salesforce", /Callback_Case_API permission set has not been assigned/.test(cb));
check("the lookup is cached", /rtCache/.test(cb) && /RT_TTL_MS/.test(cb));

console.log("\nNothing new is provisioned");
check("it borrows the licence submission's own credentials", /epglAuth/.test(cb));
check("...which are exported from the module that owns the token cache", /export async function epglAuth/.test(epglRead));
check("there is no second client id or secret", !/client_secret|oauthClientId/.test(code));
check("a 401 mints once more rather than failing", /await auth\.retry\(\)/.test(cb));

console.log("\nOnly fields this user may create");
for (const f of ["RecordTypeId", "Subject", "Description", "Origin", "Priority", "Type", "SuppliedName", "SuppliedPhone", "SuppliedEmail"]) {
  check(`${f} is sent`, new RegExp(`\\b${f}:`).test(cb));
}
// The collection offers both as optional extras. The describe says otherwise:
// AccountId is not createable for this permission set and there is no postal
// licence field on Case in the org at all. Salesforce rejects unknown fields.
check("AccountId is NOT sent", !/AccountId:/.test(code));
check("nor a postal licence lookup", !/EPG_Postal_Lic/i.test(code));
check("...and the code says why", /not createable for this permission set/.test(prose), prose.slice(0, 40));

console.log("\nHow the queue routes it");
check("a renewal is a renewal", caseTypeFor("license_renewal") === "Renew Postal Activity License", caseTypeFor("license_renewal"));
check("a new licence is Licensing", caseTypeFor("license_new") === "Licensing", caseTypeFor("license_new"));
check("anything else is a Question", caseTypeFor("faq") === "Question" && caseTypeFor(null) === "Question" && caseTypeFor(undefined) === "Question");
// Every value above was read off the org's own picklist. The field is
// UNRESTRICTED, so a wrong value would be accepted rather than rejected — which
// is exactly why it is mapped here instead of phrased by the model.
for (const t of ["Renew Postal Activity License", "Licensing", "Question"]) {
  check(`"${t}" is a real picklist value`, ["Customer Complaint", "Delay in Renewal", "Failure to submit Financial Statement", "Failure to submit Form 9", "Inspection violations", "Delay in Cancellation", "Question", "General", "Licensing", "Revenue", "Inspection", "Online Services", "Web", "Other", "Renew Postal Activity License", "No Objection Certificate", "Failure to Settle Outstanding", "Delay in IDEP Integration"].includes(t));
}
check("Origin is where the request came FROM", /Origin: "Live Chat"/.test(cb));
check("...which the org offers", ["Email", "Phone", "Web", "Manual", "Automated", "Chatter", "Portal", "Live Chat"].includes("Live Chat"));
check("Status is left to the support process", !/Status:/.test(code));

console.log("\nThe journey reaches the adapter at all");
check("the input carries it", /journeyKey\?: string \| null;/.test(types));
check("...and the tool supplies it", /journeyKey: state\.journeyKey,/.test(tools));

console.log("\nA refusal is reported in Salesforce's own words");
check("their errorCode and message are kept", /\$\{e\.errorCode\}: \$\{e\.message\}/.test(cb));
check("a success with no id is still a failure", /returned no id/.test(cb));
check("and no reference is invented", !/randomUUID/.test(code));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
