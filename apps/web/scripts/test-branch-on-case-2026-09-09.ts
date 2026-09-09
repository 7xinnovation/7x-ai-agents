/**
 * The branch the customer chose belongs on the case, not in the model's head.
 *
 * Reported 9 September: the summary read "الفرع: لم يُحدد بعد" — branch not yet
 * chosen — beside "الصندوق: 2290", a box number that could only have come from a
 * branch they had just picked. Recording it was left to the model, and the model
 * was busy listing boxes.
 *
 * Run from apps/web:  npx tsx scripts/test-branch-on-case-2026-09-09.ts
 */
export {};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const { readFileSync } = await import("node:fs");
const intg = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");

console.log("\nAsking a branch for its boxes IS choosing it");
check("the branch of the last lookup is remembered", /let lastFreeBoxesBranch/.test(intg));
check("...taken from the request, not guessed", /lastFreeBoxesBranch = \{ officeId: askedAt/.test(intg));
check("...with its name where we know it", /name: known\[askedAt\] \?\? askedAt/.test(intg));
check("and it is exposed", /getChosenBranch: \(\) => lastFreeBoxesBranch/.test(intg));

console.log("\nAnd it reaches the case");
check("the route reads it back", /const branchNow = apiTools\.getChosenBranch\(\)/.test(route));
check("it writes the NAME, not the officeId", /branch: branchNow\.name/.test(route));
check("it never overwrites a branch already recorded", /!str\(finalState\.data\.branch\)/.test(route));
check("...and does nothing when no branch was looked up", /if \(branchNow && !str/.test(route));

console.log("\nEvery bundle is shown");
check("the response says how many there are", /SHOW ALL \$\{names\.length\} OF THESE BUNDLES/.test(intg));
check("...and names them in order", /names\.join\(", "\)/.test(intg));
check("it says leaving one out chooses for the customer", /leaving one out chooses for them/.test(intg));
check("and that it holds in Arabic too", /an Arabic reply must carry all/.test(intg));
check("the note is built from the response, not a fixed list", /list\.map\(\(bn\) => asStr\(bn\.name_En\)/.test(intg));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
