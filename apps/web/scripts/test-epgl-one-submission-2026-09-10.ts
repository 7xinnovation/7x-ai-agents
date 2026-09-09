/**
 * One application, submitted once, and paid for once it exists.
 *
 * Both of these came out of running the EPGL card branch end to end on
 * 9 September — the branch the Virtual IBAN runs had never exercised, because
 * VIBAN refuses payment earlier and so never reaches the gate that was broken.
 *
 * What happened: request_payment will not open a card until the thing being paid
 * for exists, and it decides that by reading state.reference. Nothing but the
 * internal submit_case was writing that field, and a licence submits through
 * Salesforce instead. So the model submitted, asked for payment, was told to
 * submit first, obeyed, and went round again. Seven licence requests for one
 * application, eight documents attached to each, no payment card, and a closing
 * suggestion that the customer's browser was broken.
 *
 * These are source-level checks. The behaviour lives inside a closure the size
 * of a small program, and a test that reconstructs enough of the world to call
 * it ends up asserting the reconstruction.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-one-submission-2026-09-10.ts
 */
export {};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const { readFileSync } = await import("node:fs");
const orch = readFileSync(new URL("../../../packages/core/src/ai/orchestrator.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");
const integrations = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");

console.log("\nThe reference a backend submission earns is written down");
const saveBlock = orch.slice(orch.indexOf("apiFlow journeys complete through a backend saveTool"), orch.indexOf("const res = await dispatchTool"));
check("a successful saveTool still yields the submission", /yield \{ type: "submitted", reference: ref \}/.test(saveBlock));
check("...and now writes it into the case as well", /state = \{ \.\.\.state, status: "submitted", reference: ref \}/.test(saveBlock));
check("...through a case event, so the turn persists it", /yield \{ type: "case", state \}/.test(saveBlock));
check("it is not rewritten when it has not changed", /state\.reference !== ref/.test(saveBlock));
check("the same shape submit_case writes, so the two cannot disagree",
  /state = \{ \.\.\.state, status: "submitted", reference \}/.test(tools));

console.log("\nWhich is the field the payment gate reads");
check("request_payment gates on state.reference", /submitBeforePayment && !state\.reference/.test(tools));
check("...and says nothing was charged", /NOTHING has been charged and nothing has gone wrong/.test(tools));

console.log("\nA second CREATE is refused; an UPDATE is not");
const dup = integrations.slice(integrations.indexOf("One application, submitted once."), integrations.indexOf("if (/submitlicenserequest$/i.test(toolName)) {"));
check("the guard is scoped to the submit tool", /submitlicenserequest\$\/i\.test\(toolName\)/.test(dup));
check("it only fires once something has been submitted", /alreadySubmitted/.test(dup));
check("an update shape is recognised by Id or Name", /asStr\(lb\?\.Id\) \|\| asStr\(lb\?\.Name\)/.test(dup));
check("...and is let through", /if \(licence && !isUpdate\)/.test(dup));
check("nothing is sent when it is refused", /NOTHING WAS SENT/.test(dup));
check("the model is told to pay rather than retry", /call request_payment now/.test(dup));
check("the customer is not asked to re-upload", /do NOT ask them to re-upload/.test(dup));

console.log("\nRead from the case, never remembered in the tool layer");
check("the guard consults the live case first", /opts\.submittedReference\?\.\(\) \?\? lastLicenceRequestId/.test(integrations));
check("the accessor exists on the options", /submittedReference\?: \(\) => string \| null/.test(integrations));
check("route.ts wires it to the live state", /submittedReference: \(\) => liveState\.reference \?\? null/.test(route));
// The whole point. offeredBoxAt was a variable in this same closure, rebuilt on
// every HTTP request, and it was therefore empty on exactly the turn it was
// needed. A duplicate submission arrives on a LATER turn than the original.
check("...because a closure variable is empty on the next turn — which is the one that matters",
  /rebuilt\s*\n\s*\* per HTTP request/.test(integrations) || /rebuilt/.test(integrations));

console.log("\nAnd the status read knows which request it is asking about");
check("getRequestStatus is given the id", /getrequeststatus\$\/i\.test\(toolName\)/.test(integrations));
check("...from the request this conversation created", /inp\.id = lastLicenceRequestId/.test(integrations));
check("...and never over one the model supplied", /if \(!asStr\(inp\.id\)\)/.test(integrations));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
