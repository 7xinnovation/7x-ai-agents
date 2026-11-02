/**
 * The rule written for the 2 November EPGL 2.0 round says what it has to say.
 *
 * Four reports and one call log; each one should be findable in the rule, in
 * the words the behaviour will be judged by. Run from apps/web:
 *   npx tsx scripts/test-epgl-20-test-round-2026-11-02.ts
 */
import { MARKER, RULE, WEIGHT_FIELD, WEIGHT_HELP } from "./epgl-20-test-round-2026-11-02";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const has = (...bits: string[]) => bits.every((b) => RULE.includes(b));

console.log("\n1 — a two-word reply");
check("the bare acknowledgements are named", has("No problem", "Of course", "Got it", "Sure"));
check("and told what to say instead", has("what you changed", "what you need now"));
check("a different company invalidates what was read off the old licence", has("Do not carry a single captured value across"));
check("and the old file is not left showing as uploaded", RULE.includes('Showing the old file as "Uploaded"'));

console.log("\n2 — two asks in one message");
check("the incident is named", has("Beneficial Ownership Declaration upload block"));
check("the rule is about asks, not uploads", has("never TWO ASKS"));
check("a choice plus an upload is two", has("choice and an upload block is two"));
check("the preparation list still carries nothing", has("preparation list is text"));

console.log("\n3 — the weight");
check("never asked", has("NEVER ASK FOR THE MAXIMUM SHIPMENT WEIGHT"));
check("set to 30 on a CEP30 product", has(`collect_field(${WEIGHT_FIELD}, 30)`));
check("and heavier is a product question", has("that is a product question"));
check("the field's own help says the same", WEIGHT_HELP.includes("NOT A QUESTION FOR THE CUSTOMER") && WEIGHT_HELP.includes("30"));

console.log("\n4 — the locked application");
check("the lock is final", has("A LOCKED APPLICATION IS AN ANSWER"));
check("six attempts are named as the bug", has("six times"));
check("one create, and never again unchanged", has("Send a create ONCE", "never send it again unchanged"));
check("the duplicate check comes first", has("RUN THE DUPLICATE CHECK BEFORE THE FIRST SUBMIT"));
check("the customer is given the reference and the status", has("it is <reference>, it is <status>"));
check("and the information request they were told to raise", has("information request"));
check("no application id on a create", has("Never send an application id on a create"));
check("a 404 is not a verdict on their submission", has("IS NOT A REPORT ON THEIR SUBMISSION"));
check("the invented sentence is quoted so it is not written again", has("it looks like the earlier submission didn't complete successfully"));

console.log("\nthe rule itself");
check("carries its marker, so it applies once", RULE.includes(MARKER));
check("and the marker is dated", MARKER.includes("2026-11-02"));
check("no fenced block leaks out of it", !/\n```/.test(RULE));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
