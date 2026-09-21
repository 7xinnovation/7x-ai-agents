/**
 * One application, one submission (PreProd2, 21 September).
 *
 * Salesforce's own field history on LR-37533:
 *
 *   08:51:17  created                         Under document review
 *   08:51:57  our payment notification        Payment Verified
 *   08:51:59  their automation                Closed
 *   08:52:23  WE SUBMITTED IT AGAIN           Under document review
 *   08:52:25  our payment notification again  Payment Verified
 *   08:52:27  their automation again          Closed
 *
 * The last three lines are ours: a minute after a successful submission the
 * model called the save tool again, re-opening a request their workflow had
 * finished with. The same shape on 9 September produced SEVEN licence requests
 * for one application.
 *
 * The guidance already said "NEVER call the submit twice". A sentence in a
 * prompt is not a guard.
 *
 * Run from apps/web:  npx tsx scripts/test-one-submission-2026-09-21.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const guard = route.slice(route.indexOf("ONE APPLICATION, ONE SUBMISSION"), route.indexOf("if (name === AUTHORITIES_TOOL"));

console.log("\nThe guard");
check("it is on the journey's own save tool", /name === activeSaveTool/.test(guard));
check("...and only once a reference exists", /str\(liveState\.reference\)/.test(guard));
check("it refuses rather than warns", /REFUSED LOCALLY: this application has already been submitted/.test(guard));
check("...naming the reference the customer should be given", /its reference is \$\{liveState\.reference\}/.test(guard));
check("...and telling the model not to retry", /Do NOT retry/.test(guard));
check("the refusal is audited", /duplicate_submission_refused/.test(guard));

console.log("\nAn amendment is a real use of the same tool and must still work");
check("an update is recognised by the licence request's Name", /namesTheRequest/.test(guard));
check("...matched on the EPG_License_Request__c item", /License_Request__c\$\/\.test\(String\(it\?\.url/.test(guard));
check("...and the model is told what shape to use", /must carry its[\s\S]{0,40}Name \(the licence request number/.test(guard));

console.log("\nThe reasoning is recorded where the code is");
check("the field history is in the comment, not only in a commit", /08:52:23  WE SUBMITTED IT AGAIN/.test(guard));
check("...and so is why a prompt line was not enough", /A sentence in a prompt is not a\s+\*?\s*guard/.test(guard.replace(/\n\s*\*\s?/g, " ")));

console.log("\nWhat it must NOT touch");
check("a journey with no apiFlow save tool is unaffected", /const activeSaveTool = findJourney\(/.test(guard));
check("...and neither is a first submission", /&& str\(liveState\.reference\)\) \{/.test(guard));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
