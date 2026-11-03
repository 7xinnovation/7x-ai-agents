/**
 * References do not cross between EPGL's two orgs (2026-11-03).
 *
 * The 2.0 duplicate check runs on preprod2; the application is created on
 * newlaw. A customer was offered "Update existing application (LR-37795)" and
 * "Check status of LR-37795" for a record newlaw answers with "No application
 * found", and the same number was twice sent back as applicationId__c on a
 * create. Both bodies below are the ones actually logged.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-cross-org-2026-11-03.ts
 */
import {
  withoutForeignApplicationId,
  maskForeignApplicationRefs,
  isTwoZeroDuplicateCheck,
  FOREIGN_REFS_NOTE,
} from "@/lib/epglCrossOrg";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

/** The create, as the model composes it. `appId` is what it put on the two items. */
const create = (appId: unknown) => ({
  body: {
    allOrNone: true,
    compositeRequest: [
      { method: "POST", url: "/services/data/v60.0/sobjects/Account", referenceId: "NewAccount", body: { Name: "7X TEST" } },
      { method: "POST", url: "/services/data/v60.0/sobjects/Contact", referenceId: "NewContact", body: { AccountId: "@{NewAccount.id}" } },
      {
        method: "POST",
        url: "/services/data/v60.0/sobjects/EPG_License_Request__c",
        referenceId: "NewLicenseRequest",
        body: { Product_Code: "CEP30-UAE-SME-INTL", ...(appId === undefined ? {} : { applicationId__c: appId }) },
      },
      {
        method: "POST",
        url: "/services/data/v60.0/sobjects/EPG_Document__c",
        referenceId: "Doc1",
        body: { Document_Type: "Trade Licence", ...(appId === undefined ? {} : { applicationId__c: appId }), content: "JVBE" },
      },
    ],
  },
});

const itemsOf = (input: unknown) =>
  ((input as { body?: { compositeRequest?: { body?: Record<string, unknown> }[] } })?.body?.compositeRequest ?? []);
const appIds = (input: unknown) => itemsOf(input).map((i) => i.body?.applicationId__c);

console.log("\nthe create of 3 November 08:13");
const stripped = withoutForeignApplicationId(create("LR-37795"));
check("both references are taken off", appIds(stripped.input).every((v) => v === undefined), appIds(stripped.input));
check("and reported for the log", stripped.removed.join(",") === "LR-37795,LR-37795", stripped.removed);
check("the four items all survive", itemsOf(stripped.input).length === 4, itemsOf(stripped.input).length);
check("nothing else on the licence request is touched",
  (itemsOf(stripped.input)[2]!.body as Record<string, unknown>).Product_Code === "CEP30-UAE-SME-INTL");
check("nor on the document", (itemsOf(stripped.input)[3]!.body as Record<string, unknown>).content === "JVBE");
check("allOrNone is kept",
  ((stripped.input as { body?: Record<string, unknown> }).body as Record<string, unknown>).allOrNone === true);

console.log("\nwhat it leaves alone");
const nul = withoutForeignApplicationId(create(null));
check("null — what the 08:16 create that SUCCEEDED sent",
  !nul.removed.length && appIds(nul.input).slice(2).every((v) => v === null), appIds(nul.input).slice(2));
const ref = withoutForeignApplicationId(create("@{NewLicenseRequest.id}"));
check("a composite reference, resolved inside this same request", !ref.removed.length, ref.removed);
const empty = withoutForeignApplicationId(create("   "));
check("an empty string", !empty.removed.length, empty.removed);

const docsOnly = {
  body: {
    allOrNone: false,
    compositeRequest: [
      { method: "POST", url: "/services/data/v60.0/sobjects/EPG_Document__c", referenceId: "Doc1", body: { applicationId__c: "LR-54109" } },
    ],
  },
};
const d = withoutForeignApplicationId(docsOnly);
check("the document composite, which has no licence request in it", !d.removed.length && d.input === docsOnly, d.removed);

check("a body with no compositeRequest", withoutForeignApplicationId({ body: { x: 1 } }).removed.length === 0);
check("no body at all", withoutForeignApplicationId(undefined).removed.length === 0);
check("an item whose body is not an object", withoutForeignApplicationId({
  body: { compositeRequest: [{ url: "/services/data/v60.0/sobjects/EPG_License_Request__c", body: "not an object" }] },
}).removed.length === 0);
const untouched = create(undefined);
check("an untouched input comes back as the SAME object", withoutForeignApplicationId(untouched).input === untouched);

console.log("\nthe duplicate check of 3 November 09:45");
const REPORTED =
  '{"matchFound":true,"matchedRequests":[{"recommendedAction":"Update existing application",' +
  '"matchedRequestStatus":"Under document review","matchedRequestNumber":"LR-37795"}],' +
  '"matchedRecordIds":["001FW00GHRYBSBYY25"]}';
const m = maskForeignApplicationRefs(REPORTED);
check("the number is gone", !m.result.includes("LR-37795"), m.result);
check("so is the record id", !m.result.includes("001FW00GHRYBSBYY25"), m.result);
check("two references withheld", m.masked === 2, m.masked);
check("the verdict survives", JSON.parse(m.result).matchFound === true, m.result);
check("and the status", m.result.includes("Under document review"), m.result);
check("and the recommended action", m.result.includes("Update existing application"), m.result);
check("still one JSON document", typeof JSON.parse(m.result) === "object");

console.log("\nwhat the mask leaves alone");
const none = maskForeignApplicationRefs('{"matchFound":false,"matchedRequests":[]}');
check("a check that matched nothing is untouched", none.masked === 0 && none.result === '{"matchFound":false,"matchedRequests":[]}', none);
const other = maskForeignApplicationRefs('{"products":[{"name":"Product_Code"}]}');
check("a catalogue response", other.masked === 0, other);
check("the note names the one thing it must never do", FOREIGN_REFS_NOTE.includes("applicationId__c"));

console.log("\nthe awkward shapes");
const many = maskForeignApplicationRefs(
  '{"matchedRequests":[{"matchedRequestNumber":"LR-1"},{"matchedRequestNumber":"LR-2"}],"matchedRecordIds":["a","b","c"]}'
);
check("every match, and every id, counted", many.masked === 5, many.masked);
check("none of them survive", !/LR-\d/.test(many.result) && !/"a"/.test(many.result), many.result);
const prose = maskForeignApplicationRefs("EPGL's records show LR-37795 and LR-37796 for this licence.");
check("prose falls back to the number itself", !prose.result.includes("LR-37795") && prose.masked === 2, prose);
const broken = maskForeignApplicationRefs('{"matchedRequestNumber":"LR-37795"');
check("JSON that does not parse still has the number taken out", !broken.result.includes("LR-37795"), broken.result);
const nested = maskForeignApplicationRefs('{"a":{"b":[{"salesforceRecordId":"a11FW","requestIdentifier":"LR-37795","requestStatus":"x"}]}}');
check("nested, under any key", !nested.result.includes("LR-37795") && nested.result.includes("x"), nested.result);
check("and the keys around it survive", JSON.parse(nested.result).a.b[0].requestStatus === "x");

console.log("\nwhich journey asked — both agents carry both orgs");
check("the 1.x call of 22 October",
  !isTwoZeroDuplicateCheck({ tradeLicenseNumber: "1196781", postalLicenseNumber: "377", serviceId: "S-EPG-000003" }));
check("the 2.0 call of 3 November",
  isTwoZeroDuplicateCheck({ tradeLicenseNumber: "CN-1234567", productCode: "CEP30-UAE-SME-DOM" }));
check("every other product code in the packs",
  ["LOCKERS", "FOODMED", "OUTSOURCE", "CEP30-GEN-INTL", "INTERMED"].every((p) => isTwoZeroDuplicateCheck({ productCode: p })));
check("a serviceId wins even beside a product code",
  !isTwoZeroDuplicateCheck({ productCode: "LOCKERS", serviceId: "S-EPG-000003" }));
check("a 2.0 call the model dropped the product code from is left alone",
  !isTwoZeroDuplicateCheck({ tradeLicenceNumber: "CN-5234567" }));
check("an empty product code is not a product code", !isTwoZeroDuplicateCheck({ productCode: "  " }));
check("no input at all", !isTwoZeroDuplicateCheck(undefined));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
