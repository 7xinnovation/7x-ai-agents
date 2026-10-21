/**
 * One enquiry gets one reference, and the term the customer picked is the one
 * read back to them.
 *
 * Three bugs reported on 20 October, two of them the same bug on both agents:
 *
 *  - NXN, duplicate case: a complaint raised as ENQ-F64B6E11, the customer
 *    answers "No, thanks", and the next reply hands them ENQ-B4607CDE for the
 *    same complaint.
 *  - EPGL, three Salesforce cases in one conversation — 500NM009JB0XLv2YYG,
 *    500NM009Gm1TDq8YIG, 500NM009IBmKe3YYYS — one per customer turn, the
 *    second announced as "I filed the escalation request but I need to
 *    actually submit it properly". Nothing had failed.
 *  - NXN, the wrong term: the customer picks "1 Year" and the reply opens
 *    "Three years, noted." before correcting itself two lines later.
 *
 * And one found while reading the screenshots: the EPGL reference handed to the
 * customer is the Case record id, not the CaseNumber their team works by.
 *
 * Run from apps/web:  npx tsx scripts/test-duplicate-escalation-2026-10-21.ts
 */
import { readFileSync } from "node:fs";
import { emptyCase } from "@dialog/config";
import { sameEnquiry } from "@dialog/core";
import { durationChosen, contradictsChosenDuration, narrationGuard } from "../lib/narrationGuard";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const tools = read("../../../packages/core/src/ai/tools.ts");
const caseSchema = read("../../../packages/config/src/case.ts");
const callback = read("../lib/epglCallback.ts");
const route = read("../app/api/chat/route.ts");

console.log("\nThe case remembers the enquiry it already raised");
check("CaseState carries it", /escalation: z\s*\n?\s*\.object\(\{/.test(caseSchema) || /escalation: z[\s\S]{0,200}reference: z\.string\(\)/.test(caseSchema));
check("...with the time it was raised", /at: z\.string\(\)/.test(caseSchema));
check("...and what it was about", /reason: z\.string\(\)\.default\(""\)/.test(caseSchema));
check("a fresh case starts with none", emptyCase().escalation === null, emptyCase().escalation);
check("the tool writes it on success", /escalation: \{ reference, at: new Date\(\)\.toISOString\(\), reason: String\(input\.reason \?\? ""\) \}/.test(tools));

console.log("\nA second call is answered with the first reference");
check("the fence is before the adapter call", tools.indexOf("const already = state.escalation;") < tools.indexOf("await adapters.crm.createCallback"));
check("...and returns the reference already given", /ALREADY RAISED — NOTHING FAILED/.test(tools) && /\$\{already\.reference\}/.test(tools));
check("...telling the model not to invent a new one", /do NOT invent a new reference/.test(tools));
check("...and not to narrate a re-filing", /submitting it properly/.test(tools));
check("it is not an error, so the turn carries on", !/ALREADY RAISED[\s\S]{0,900}isError: true/.test(tools));

console.log("\nSame matter, restated, is the same enquiry");
const first = "I'm not happy with the experience I want to escalate an issue";
check("the same words", sameEnquiry(first, first));
check("...reworded", sameEnquiry(first, "not happy with the experience, want to escalate this issue"));
check("...and the terser retry", sameEnquiry(first, "escalate the issue about the experience"));
check("a reason-less retry never opens a second case", sameEnquiry(first, ""));
check("a genuinely different matter is not the same", !sameEnquiry(first, "my key was never delivered to the Al Ramool branch"));

console.log("\nEPGL hands over the number their team works by");
check("the CaseNumber is read back", /fields=CaseNumber/.test(callback));
check("...and is what the customer is given", /reference: caseNumber \?\? created\.id/.test(callback));
check("a failed read still returns the case", /caseNumberOf\(auth, created\.id\)\.catch\(\(\) => null\)/.test(callback));
check("...and says so in the log", /epgl_callback_no_case_number/.test(callback));

console.log("\nA term the customer did not choose");
check("a card click reads as a choice", durationChosen("1 Year") === 1, durationChosen("1 Year"));
check("...typed, too", durationChosen("3 years") === 3, durationChosen("3 years"));
check("...spelled out", durationChosen("ten years") === 10, durationChosen("ten years"));
check("...in Arabic", durationChosen("سنة") === 1 || durationChosen("3 سنوات") === 3, [durationChosen("سنة"), durationChosen("3 سنوات")]);
check("a sentence is not a choice", durationChosen("what's the difference between 1 year and 3 years?") === null);
check("nothing is not a choice", durationChosen("") === null);

check("the reported acknowledgement is caught", contradictsChosenDuration("Three years, noted.", 1));
check("...and the right one is not", !contradictsChosenDuration("1 year, noted.", 1));
check("a price sentence is left alone", !contradictsChosenDuration("The 3-year option is AED 970.00 including registration.", 1));
check("...and so is an explanation", !contradictsChosenDuration("Emirates Post discounts the 5 and 10 year terms, which is why they are not simply the annual rate multiplied.", 1));
check("nothing is dropped when no term was chosen", !contradictsChosenDuration("Three years, noted.", null));

console.log("\nEnd to end, on the reply that was reported");
const g = narrationGuard({ chosenDuration: () => 1 });
const reported = "Three years, noted. Would you like to add an authorised agent to this PO Box?\n1 year, noted.\n";
const out = g.push(reported) + g.flush();
check("the wrong acknowledgement is gone", !/Three years/i.test(out), out);
check("the question survives", /Would you like to add an authorised agent/.test(out), out);
check("the right acknowledgement survives", /1 year, noted\./.test(out), out);

console.log("\nWired into the turn");
check("the guard is given the customer's own message", /narrationGuard\(\{ chosenDuration: \(\) => durationChosen\(body\.userMessage\) \}\)/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
