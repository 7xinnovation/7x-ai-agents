/**
 * The Virtual IBAN branch of EPGL's payment process map.
 *
 * Two things must hold, and neither may depend on the model: an applicant who
 * chose the Virtual IBAN must never be shown a card, and Finance must be told
 * to raise one — with the company details their process map has them look up by
 * hand.
 *
 * Run from apps/web:  npx tsx scripts/test-viban-2026-09-08.ts
 */
import { notifyOpsForSubmission } from "../lib/opsNotify";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const CASE = {
  payment_method: "viban",
  company_name: "YI FANG TAIWAN FRUIT TEA L.L.C",
  company_name_ar: "اي فانغ تايوان فروت للشاي ش.ذ.م.م",
  trade_license_number: "697670",
  license_issue_date: "2024-11-05",
  license_expiry_date: "2026-11-04",
  emirate: "Dubai",
  contact_name: "Emre Karayalcin",
  contact_email: "applicant@example.com",
  contact_phone: "0553708434",
};

const notify = (data: Record<string, unknown>) =>
  notifyOpsForSubmission({ reference: "a11FW000VfuZVYGYI4", journeyKey: "new_license", data, agentName: "EPGL Dialog" });

console.log("\nFinance is asked to raise the IBAN");
{
  // No recipient configured: the outcome must still be produced and reported,
  // never silently skipped -- that is how a submission goes unnoticed.
  delete process.env.EPGL_FINANCE_EMAIL;
  const out = await notify(CASE);
  const v = out.find((o) => o.kind === "viban_request");
  check("a viban_request outcome is produced", !!v, out.map((o) => o.kind));
  check("and it reports why nothing was sent", v?.result.ok === false && (v.result as any).reason === "recipient_not_configured", v?.result);
}
{
  process.env.EPGL_FINANCE_EMAIL = "finance@example.com";
  const out = await notify(CASE);
  const v = out.find((o) => o.kind === "viban_request");
  check("addressed to the configured Finance mailbox", v?.to === "finance@example.com", v?.to);
}

console.log("\nOnly when the Virtual IBAN was actually chosen");
{
  process.env.EPGL_FINANCE_EMAIL = "finance@example.com";
  const card = await notify({ ...CASE, payment_method: "gateway" });
  check("a card payment raises nothing", !card.some((o) => o.kind === "viban_request"), card.map((o) => o.kind));
  const none = await notify({ ...CASE, payment_method: "" });
  check("an unanswered choice raises nothing", !none.some((o) => o.kind === "viban_request"), none.map((o) => o.kind));
  const upper = await notify({ ...CASE, payment_method: "VIBAN" });
  check("the value is read case-insensitively", upper.some((o) => o.kind === "viban_request"), upper.map((o) => o.kind));
}

console.log("\nrequest_payment refuses a Virtual IBAN outright");
{
  // The gate reads the case, so it holds whatever the model was told.
  const tools = await import("../../../packages/core/src/ai/tools");
  const src = (await import("node:fs")).readFileSync(
    new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8"
  );
  check("the guard exists in request_payment", /payment_method[\s\S]{0,400}?method === "viban"/.test(src));
  check("it is refused, not merely discouraged", /method === "viban"[\s\S]{0,900}?isError: true/.test(src));
  check("it says nothing was charged", /method === "viban"[\s\S]{0,900}?NOTHING has been charged/.test(src));
  check("it offers the way back to a card", /method === "viban"[\s\S]{0,900}?collect_field\(payment_method, gateway\)/.test(src));
  // It must sit BEFORE the gateway is ever reached.
  const guard = src.indexOf('method === "viban"');
  const initiate = src.indexOf("adapters.payment.initiate");
  check("the guard runs before the gateway is called", guard !== -1 && initiate !== -1 && guard < initiate, { guard, initiate });
  check("tools module still loads", typeof tools === "object");
}

console.log("\nAnd payment waits for the application to exist");
{
  const src2 = (await import("node:fs")).readFileSync(
    new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8"
  );
  check("request_payment refuses with no case reference", /submitBeforePayment && !state\.reference/.test(src2));
  check("it names the tool to call first", /sub\.apiFlow\.saveTool \?\? "the submission tool"/.test(src2));
  check("it says nothing was charged", /submitBeforePayment[\s\S]{0,900}?NOTHING has been charged/.test(src2));
  check("it is an error, so the model cannot read past it", /submitBeforePayment[\s\S]{0,900}?isError: true/.test(src2));
  const gate = src2.indexOf("submitBeforePayment && !state.reference");
  const initiate = src2.indexOf("adapters.payment.initiate");
  check("and it runs before the gateway is touched", gate !== -1 && gate < initiate, { gate, initiate });
  const schema = (await import("node:fs")).readFileSync(
    new URL("../../../packages/config/src/journey.ts", import.meta.url), "utf8"
  );
  check("the flag defaults to off, so no other journey changes", /submitBeforePayment: z\.boolean\(\)\.default\(false\)/.test(schema));
}

console.log("\nAnd the RENDERED flow teaches the same order");
{
  const { readFileSync } = await import("node:fs");
  const prompt = readFileSync(new URL("../../../packages/core/src/ai/prompt.ts", import.meta.url), "utf8");
  // The numbered steps are the most literal instruction the model gets. They
  // used to say "call request_payment ... do NOT call the save before the
  // payment is paid" -- the exact opposite of what EPGL needs -- and they won
  // over the journey notes every time.
  check("the renderer branches on submitBeforePayment", /f\.submitBeforePayment && f\.saveTool/.test(prompt));
  const branch = prompt.slice(prompt.indexOf("if (f.submitBeforePayment && f.saveTool)"), prompt.indexOf("} else {"));
  check("step 3 is the save, not the payment", /3\. After the customer confirms, call \$\{f\.saveTool\} FIRST/.test(branch));
  check("it says the save charges nothing", /NOTHING is charged by this call/.test(branch));
  check("step 4 is the payment", /4\. THEN call request_payment/.test(branch));
  check("a refusal is named as expected, not a fault", /refusal is expected rather than a fault/.test(branch));
  check("the old pay-first wording survives for everyone else", /Do NOT call it before the payment is "paid"/.test(prompt));
}

console.log("\nThe duplicate check is called once, not five times");
{
  const { readFileSync } = await import("node:fs");
  const intg = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
  const blk = intg.slice(intg.indexOf("THE DUPLICATE CHECK, ASKED ONCE"), intg.indexOf("TELL EMIRATES POST WHICH TRANSACTIONS ARE OURS"));
  check("a decided case short-circuits the tool", /if \(decided\) \{[\s\S]{0,120}?return \{/.test(blk));
  check("...before Salesforce is called at all", intg.indexOf("THE DUPLICATE CHECK, ASKED ONCE") < intg.indexOf("let res = await executeOperation"));
  check("the reply carries no list to re-present", !/matchedRequests/.test(blk));
  check("it names the decision back", /already decided: \$\{decided\}/.test(blk));
  check("it says to submit next", /submit the application with the submit tool/.test(blk));
  check("it forbids a second call", /Do NOT call this tool again/.test(blk));
  check("it is not an error, so it cannot read as a fault", !/isError/.test(blk));
  check("an undecided case still runs the check", /const decided = opts\.duplicateDecision\?\.\(\);\s*if \(decided\)/.test(blk));
}

console.log("\nThe two payment gates must not deadlock each other");
{
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  // request_payment refuses until the submission exists; blockUnpaidSaves used to
  // refuse the submission until the payment existed. Neither could go first, and
  // the assistant said so before giving the customer a phone number.
  check("a submit-first journey is exempt from blockUnpaidSaves", /!j\.submission\?\.apiFlow\?\.submitBeforePayment/.test(route));
  check("backend-gateway journeys keep their existing exemption", /!j\.submission\?\.apiFlow\?\.confirmTool/.test(route));
  check("internal-checkout journeys keep the gate", /j\.submission\?\.requiresPayment &&\s*j\.submission\?\.apiFlow\?\.saveTool/.test(route));
}

console.log("\nA Virtual IBAN application is submitted, not held");
{
  const { readFileSync } = await import("node:fs");
  const intg = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
  check("the status is only ever considered for viban", /facts\.paymentMethod\?\.toLowerCase\(\) === "viban"/.test(intg));
  check("...on EPG_Request_Status__c", /EPG_Request_Status__c:/.test(intg));
  // 2026-09-13: EPGL gave us the whole progression, and every step of it is
  // theirs -- Under document review -> Documents approved -> Virtual Iban
  // Approved -> Payment Verified -> Closed. "Pending Payment", which is what we
  // had been stamping, appears nowhere in it, and a request in a status their
  // process never assigns is one their process cannot move.
  check("we no longer name a status ourselves", /EPGL_VIBAN_STATUS \?\? ""/.test(intg));
  check("...and their progression is recorded beside the decision", /Under document review -> Documents approved -> Virtual Iban Approved/.test(intg));
  check("the value is settable, since it is a picklist", /process\.env\.EPGL_VIBAN_STATUS/.test(intg));
  check("an empty setting turns it off entirely", /&& vibanStatus \? vibanStatus : undefined/.test(intg));
  check("a card payment gets no such status", /=== "viban" && vibanStatus/.test(intg));
  check("the chosen method reaches the facts", /paymentMethod: str\(liveState\.data\.payment_method\)/.test(route));
  check("...read at the submit, not when the tools were built", /epglRequestFacts:\s*\n\s*agent\.definition\.tenantSlug === "epgl"\s*\n\s*\? \(\) => \(\{/.test(route));
  check("it never overwrites a status the model set", /Never overwrite what the model read off the documents/.test(intg));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
