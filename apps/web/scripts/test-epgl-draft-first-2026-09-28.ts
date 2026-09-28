/**
 * Finance hear about a Virtual IBAN when it is CHOSEN (2026-09-28).
 *
 * "A draft should be created before they reach the step where it asks them if
 * they want to pay online or by VIBAN — so it creates the draft on Salesforce,
 * and when they pay or ask for a VIBAN it updates that existing request."
 *
 * Half of it was already true: `submitBeforePayment` has been on since
 * 8 September and request_payment refuses until the licence request exists,
 * because the payment notification keys on its Salesforce id. What was not was
 * the position of the payment QUESTION — ask, submit, then pay — so an
 * applicant who stopped at the two buttons left nothing on EPGL's side at all.
 *
 * And it could not simply be reordered, because one line of code held it in
 * place: the Virtual IBAN request to Finance rode along with the SUBMISSION
 * notifications, so it went out only if the method had already been chosen by
 * then. Three rules in the guidance said "ask first" and two of them named that
 * as the reason. So the trigger moves to the choice, and the reason goes with
 * it — along with a bug nobody had noticed: an applicant who switched to a
 * Virtual IBAN after submitting reached nobody.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-draft-first-2026-09-28.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const ops = readFileSync(new URL("../lib/opsNotify.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");
const script = readFileSync(new URL("./epgl-draft-before-payment-2026-09-28.ts", import.meta.url), "utf8");

console.log("\nThe record exists before any money moves — unchanged, and the thing this rests on");
check("request_payment refuses with no submission reference", /submitBeforePayment && !state\.reference/.test(tools));
check("...and says nothing was charged", /submitBeforePayment[\s\S]{0,900}?NOTHING has been charged/.test(tools));
check("...as an error, so the model cannot read past it", /submitBeforePayment[\s\S]{0,900}?isError: true/.test(tools));
check("the reorder refuses to run against a journey that pays first",
  /submitBeforePayment !== true\) \{\s*\n\s*throw new Error/.test(script));

console.log("\nThe Virtual IBAN request is fired by the CHOICE, not by the submission");
check("it is its own sender now", /export async function notifyVibanRequest/.test(ops));
check("...and no longer rides along with the submission notifications",
  !/payment_method"\)\.toLowerCase\(\) === "viban"/.test(ops.slice(0, ops.indexOf("export async function notifyVibanRequest"))));
check("the turn fires it on the case's own answer", /String\(finalState\.data\.payment_method \?\? ""\)\.toLowerCase\(\) === "viban"/.test(route));
// Keyed off the case, not off this turn: the choice may come before the
// submission or several turns after it, and both must reach Finance.
check("...against the reference the case already holds", /const vibanRef = finalState\.reference \?\? submittedRef \?\? null;/.test(route));
check("...for EPGL only", /agent\.definition\.tenantSlug === "epgl" &&\s*\n\s*vibanRef/.test(route));
check("...and never twice", /!finalState\.data\[VIBAN_NOTIFIED_KEY\]/.test(route));
check("the stamp is its own key on the case", /const VIBAN_NOTIFIED_KEY = "__viban_finance_notified_at";/.test(route));
// A send that failed used to be lost with it; now the next turn tries again.
check("it is stamped only once the email has gone", /if \(o\.result\.ok \|\| o\.result\.reason === "recipient_not_configured"\)/.test(route));
check("...an unconfigured mailbox stamps too, rather than retrying for ever", /recipient_not_configured"\) \{\s*\n\s*await mutateCase/.test(route));
check("either way it is audited", /action: o\.result\.ok \? "ops_notified" : "ops_notify_skipped"/.test(route));
check("it runs after the customer's reply, not inside it", /deferred\.push\(async \(\) => \{[\s\S]{0,400}notifyVibanRequest/.test(route));

console.log("\nWhat Finance are sent");
check("the licence request reference", /Licence request: \$\{reference\}/.test(ops));
check("...the three things their process map has them look up by hand",
  /Company name: /.test(ops) && /Trade licence number: /.test(ops) && /Trade licence issuance date: /.test(ops));
check("...and that no money came through the gateway", /No payment has been taken through the payment gateway/.test(ops));
check("the mailbox is a setting", /process\.env\.EPGL_FINANCE_EMAIL/.test(ops));
check("...and an unset one is reported, not guessed at", /recipient_not_configured/.test(ops));

console.log("\nAnd the order the guidance now teaches");
check("submit, ask, then pay", /THE ORDER IS SUBMIT, ASK, THEN PAY/.test(script));
check("...filed before the payment question is put", /Do this BEFORE you ask how they want to pay/.test(script));
check("...and nothing is charged by it", /NOTHING is charged by it/.test(script));
check("...every later step updates that record", /UPDATES that same record rather than creating a second one/.test(script));
check("...the reference is given whether or not they pick", /whether or not they pick at all/.test(script));
check("...Finance are reached whichever order it happens in", /whether it was chosen before the submission or after it/.test(script));
check("...and a second submission is still forbidden", /NEVER submit twice for the same application/.test(script));
// Three rules had accreted, each saying ask-first, two of them naming a reason
// that is no longer true.
check("the old rules are removed rather than added to", /stripPaymentRules/.test(script));
check("...by cutting each heading to the next", /HEADING = \/\[A-Z\]/.test(script));
check("...and only the payment ones", /if \(!\/\^PAYMENT OPTIONS \\\(\/\.test\(h\.text\)\) continue;/.test(script));
check("what it costs EPGL is written down", /queue will now contain applications nobody paid for/.test(script));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
