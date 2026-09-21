/**
 * "The licence request number changes with each check" (21 September).
 *
 *   panel:                 Reference LR-37425
 *   first "check status":  Reference LR-37425
 *   second "check status": Reference LR-37427
 *
 * Two real requests exist for that company, duplicates of each other, and the
 * model reached for whichever one a lookup handed back. "Check status again"
 * means THIS application, and an application whose number changes while you
 * watch it is not one anybody can quote.
 *
 * Run from apps/web:  npx tsx scripts/test-status-reference-2026-09-21.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};
const intg = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const block = intg.slice(intg.indexOf("The status of WHICH request"), intg.indexOf("// Decrypt stored secrets only at the moment"));

console.log("\nThe status check follows this conversation's own request");
check("an absent id is still filled in", /inp\.id = thisCasesRequest;/.test(block));
check("...and a DIFFERENT one is replaced", /if \(asked !== thisCasesRequest\) \{/.test(block));
check("the case's reference is the source", /thisCasesRequest = lastLicenceRequestId \?\? opts\.submittedReference\?\.\(\) \?\? null/.test(intg));
check("...which survives a turn boundary", /submittedReference: \(\) => liveState\.reference \?\? null/.test(route));

console.log("\nThe override is recorded, not silent");
check("it is audited", /status_request_redirected/.test(block));
check("...with what was asked for", /input: \{ asked \}/.test(block));
check("...and only when it actually differs", /if \(asked && asked !== thisCasesRequest\)/.test(block));

console.log("\nThe reasoning that changed, written down");
const prose = block.replace(/\n\s*\*\s?/g, " ");
check("the old rule is stated", /An id the model DID supply used to stand/.test(prose));
check("...and what it cost", /second "check status": Reference LR-37427/.test(block));
check("...and why an id is needed at all", /their endpoint is a 404/.test(prose));

console.log("\nOne guard against a second submission, not two");
// integrations.ts has held an ALREADY SUBMITTED guard since before this; a
// second copy in the chat route duplicated it and covered strictly less.
check("the existing guard is the only one", /ALREADY SUBMITTED — NOTHING WAS SENT/.test(intg));
check("...and the chat route does not repeat it", !/ONE APPLICATION, ONE SUBMISSION/.test(route));
check("it lets a genuine amendment through", /const isUpdate = Boolean\(asStr\(lb\?\.Id\) \|\| asStr\(lb\?\.Name\)\)/.test(intg));

console.log("\nAnd an unchanged status is not offered as a new answer");
{
  const prompt = readFileSync(new URL("../../../packages/core/src/ai/prompt.ts", import.meta.url), "utf8");
  check("the rule exists", /AN UNCHANGED STATUS IS NOT A NEW ANSWER/.test(prompt));
  check("...it asks for a real interval", /not "in a little while"/.test(prompt));
  check("...and forbids the lone repeated button", /do not offer "check again" as the only thing they can do/.test(prompt));
  check("...naming what else to offer", /the reference to quote, a callback, or simply finishing here/.test(prompt));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
