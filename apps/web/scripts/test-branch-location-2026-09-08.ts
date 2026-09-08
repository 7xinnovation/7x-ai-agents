/**
 * A branch that was never on the list.
 *
 * Production, 8 September. Dubai's branch list returned officeId 201 (Dubai
 * Central) and 202 (Union Square). Across three conversations the model asked
 * Rental/FreeBoxes for boxes at 212, at 209, and — having counted down the list
 * rather than read it — at 1. Each returned {"payload":[]}, which is
 * indistinguishable from a branch with nothing free, so the customer was told
 * "Box 2062 is no longer available … it has been taken since you selected it"
 * and the rental could go no further.
 *
 * These check the pieces that decide it. The live path is exercised by
 * nxn-e2e-rental against a branch that has stock.
 *
 * Run from apps/web:  npx tsx scripts/test-branch-location-2026-09-08.ts
 */
export {};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const src = (await import("node:fs")).readFileSync(
  new URL("../lib/integrations.ts", import.meta.url), "utf8"
);

console.log("\nThe branch list is remembered by id, not only by name");
check("byId is recorded alongside byName", /byId:\s*Record<string, string>/.test(src));
check("rememberBranches fills it", /ids\[id\]\s*=\s*name/.test(src));
check("branchesShown reads it back", /function branchesShown/.test(src));
check("and expires with the same TTL as the rest", /branchesShown[\s\S]{0,320}?HALL_TTL_MS/.test(src));

console.log("\nFreeBoxes will not ask about a branch nobody listed");
const guard = src.slice(src.indexOf("A BRANCH THAT WAS NEVER ON THE LIST"));
check("the guard exists", guard.length > 0);
check("it only applies to non-MyHome bundles", /!\/\^MYHOME\/\.test\(bundle\)/.test(guard.slice(0, 1400)));
check("it does nothing when no list is known yet", /valid\.length/.test(guard.slice(0, 1400)));
check("it does nothing when the id IS on the list", /!valid\.includes\(loc\)/.test(guard.slice(0, 1400)));
check("it prefers correcting to the branch the customer chose", /officeIdForBranch\(opts\.conversationId, opts\.rentalSaveFacts/.test(guard.slice(0, 1600)));
check("a correction is audited", /integration_input_corrected/.test(guard.slice(0, 2000)));
check("an unresolvable one refuses rather than guesses", /isError: true/.test(guard.slice(0, 3600)));
check("the refusal names the real branches", /valid\.map\(\(id\) => `\$\{id\} = \$\{known\[id\]\}`\)/.test(guard.slice(0, 3600)));
check("and forbids the 'box was taken' conclusion", /does NOT mean the customer's box was taken/.test(guard.slice(0, 3600)));
check("and names the position mistake that caused it", /never the position of a branch in the list/.test(guard.slice(0, 3600)));

console.log("\nOrder matters: MyHome's emirate rewrite still runs first");
const myhome = src.indexOf("lastMyHomeOfficeId = loc;");
const branchGuard = src.indexOf("A BRANCH THAT WAS NEVER ON THE LIST");
check("the MyHome rewrite precedes the branch check", myhome !== -1 && branchGuard !== -1 && myhome < branchGuard, { myhome, branchGuard });

console.log("\nThe reservation tool is reachable at all");
check("enabled:false still skips an operation", /\(op as \{ enabled\?: boolean \}\)\.enabled === false\) continue/.test(src));

console.log("\nThe reservation goes to the branch the box came from");
const sel = src.slice(src.indexOf("Reserve the box the customer actually chose"));
check("the box is remembered with its branch", /const offeredBoxAt: Record<string, string>/.test(src));
check("and the printed number with its uniqueBoxId", /const uniqueByNumber: Record<string, string>/.test(src));
check("both are filled from the FreeBoxes REQUEST, not guessed", /askedAt[\s\S]{0,220}?offeredBoxAt\[uid\] = askedAt/.test(src));
check("boxNumber is read as well as uniqueBoxID", /body\.uniqueBoxID \?\? body\.uniqueBoxId \?\? body\.boxNumber/.test(sel.slice(0, 900)));
check("a printed number resolves to its uniqueBoxId", /uniqueByNumber\[sent\]/.test(sel.slice(0, 1200)));
check("the location is corrected to where the box was offered", /body\[locKey\] = at;/.test(sel.slice(0, 3000)));
check("either spelling of the location key is handled", /body\.locationId !== undefined \? "locationId" : body\.LocationId !== undefined/.test(sel.slice(0, 3000)));
check("a correction is audited with the box it was for", /integration_input_corrected[\s\S]{0,320}?box: chosen/.test(sel.slice(0, 3000)));
check("nothing is touched when the branch already agrees", /String\(body\[locKey\] \?\? ""\) !== at/.test(sel.slice(0, 3000)));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
