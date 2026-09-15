/**
 * The placeholder rows, and their removal.
 *
 * Written 2 September: Salesforce's Documents panel listed EPG_Document__c
 * records rather than files, so a file uploaded without one landed on the
 * record and left the panel empty (LR-37176, LR-37177). We built a row per file
 * into the composite.
 *
 * Retired 15 September, at Salesforce's instruction (contract 2.0.0): "The
 * Agent does not send EPG_Document__c items inside compositeRequest; every file
 * goes to API 5 as a separate call." Their API 5 now creates the document
 * record, matches it to the checklist by name and attaches the file to it.
 *
 * What is tested here is therefore the opposite of what it used to be: that a
 * document item is REMOVED from the composite, including one the model emits
 * from guidance it read a fortnight ago, and that nothing else is disturbed.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-doc-placeholders-2026-09-02.ts
 */
import { withoutEpglDocuments } from "@/lib/integrations";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const item = (url: string, referenceId: string, body: unknown) => ({ method: "POST", referenceId, url, body });
const ACCOUNT = item("/services/data/v66.0/sobjects/Account", "NewAccount", { Name: "YI FANG" });
const DOCS = item("/services/data/v66.0/sobjects/EPG_Document__c", "NewDocument", [
  { EPG_Company__c: "@{NewAccount.id}", EPG_File_Name__c: "trade-license.pdf" },
]);
const REQUEST = item("/services/data/v66.0/sobjects/EPG_License_Request__c", "NewLicenseRequest", { serviceId__c: "7" });

const urls = (out: unknown) =>
  (((out as any)?.body?.compositeRequest ?? []) as { url: string }[]).map((i) => i.url);

{
  const out = withoutEpglDocuments({ body: { allOrNone: true, compositeRequest: [ACCOUNT, DOCS, REQUEST] } });
  check("the document item is gone", !urls(out).some((u) => /EPG_Document__c/.test(u)), urls(out));
  check("the account and the request are untouched", urls(out).length === 2, urls(out));
  check("and in their original order", /Account$/.test(urls(out)[0]!) && /EPG_License_Request__c$/.test(urls(out)[1]!));
  check("allOrNone survives", (out as any)?.body?.allOrNone === true);
}
{
  // Nothing to strip: the input must come back as it went in, by identity, so a
  // composite with no documents is never rewritten for no reason.
  const input = { body: { allOrNone: true, compositeRequest: [ACCOUNT, REQUEST] } };
  check("a clean composite is returned unchanged", withoutEpglDocuments(input) === input);
  check("so is an empty one", withoutEpglDocuments({ body: {} } as never) !== undefined);
  check("and undefined is survivable", withoutEpglDocuments(undefined) === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
