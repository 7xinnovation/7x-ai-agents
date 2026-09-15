/**
 * A submission is the one fact in a turn that must survive the turn.
 *
 * 15 September, a Virtual IBAN application: LR-37354 exists in Salesforce and
 * the case that made it still read `status: ready, reference: null`. Its eight
 * documents never went. The audit stops at the confirmation email, ten seconds
 * after a submit that took thirty-five — and then nothing: no case save, no
 * document push, no ops notification.
 *
 * Everything after the submit ran when the turn finished, and that turn did not.
 * The branch is not the cause: a Virtual IBAN turn ENDS, with a sentence and
 * nothing to click, so the customer closes the tab where a card payment holds
 * them on the page. Whichever branch gets cut loses the same things. A clean
 * VIBAN run on the same build attached all eight (LR-37355).
 *
 * Run from apps/web:  npx tsx scripts/test-submission-survives-the-turn-2026-09-15.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const onSubmitted = route.slice(route.indexOf('} else if (ev.type === "submitted")'), route.indexOf('} else if (ev.type === "escalation")'));
const push = route.slice(route.indexOf("const submittedReference ="), route.indexOf("const submittedReference =") + 3000);

console.log("\nThe submission is written the moment it happens");
{
  check("the case is persisted on the event", /await mutateCase\(session\.caseId/.test(onSubmitted));
  check("...with the status", /status: "submitted"/.test(onSubmitted));
  check("...and the reference", /reference: ev\.reference/.test(onSubmitted));
  check("a failure there is logged, never thrown at the customer", /submitted_state_persist_failed/.test(onSubmitted));
  check("the audit still records it too", /action: "case_submitted"/.test(onSubmitted));
}

console.log("\nThe documents are attempted on any later turn");
{
  check("not only the turn that submitted", /submittedRef \?\? \(finalState\.status === "submitted" \? finalState\.reference : null\)/.test(push));
  check("still only against a Salesforce record id", /\^\[a-zA-Z0-9\]\{15,18\}\$\/\.test\(submittedReference\)/.test(push));
  check("what has already gone is skipped", /!alreadySent\.has\(d\.key\)/.test(push));
  check("...read from the case", /finalState\.data\[SF_DOCS_SENT_KEY\]/.test(push));
  check("the key is private to the case, so the panel never shows it", /SF_DOCS_SENT_KEY = "__sf_documents_sent"/.test(route));
}

console.log("\nWhat goes is recorded, once");
{
  const from = route.indexOf("const sent: string[] = [];");
  const job = route.slice(from, route.indexOf("const cust = ", from));
  check("only a successful attach counts", /if \(!res\.isError\) sent\.push\(d\.key\)/.test(job));
  check("written once at the end, not per file", (job.match(/await mutateCase/g) ?? []).length === 1, (job.match(/await mutateCase/g) ?? []).length);
  check("...merged with what was already there", /\.\.\.new Set\(\[/.test(job));
  check("nothing is written when nothing went", /if \(sent\.length\) \{/.test(job));
  check("a failure to record is logged, not thrown", /sf_documents_sent_record_failed/.test(job));
}

console.log("\nWhy a re-send is safe");
{
  // EPGL's API 5 upserts on EPG_File_Id__c — measured on their org, the second
  // push of the same file answers createdNewDocument: false.
  check("the file id is the document row's own", /EPG_File_Id__c: row\.id/.test(route));
  check("...so a repeat updates rather than duplicates", /EPG_File_Id__c is the document row's own id/.test(route));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
