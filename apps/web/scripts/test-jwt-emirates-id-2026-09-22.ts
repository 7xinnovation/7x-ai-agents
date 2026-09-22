/**
 * The Emirates ID a signed token already carries (2026-09-22).
 *
 * EPGL's portal now hands the widget a signed JWT. Read out of a real one from
 * production today, it carries:
 *
 *   iss epgl.ae   aud 7x-dialog   sub/uaePassSub <uuid>
 *   email   name   accountId 001…   contactId 003…   userId 005…
 *
 * — and the route took `sub` and dropped the rest. So an EPGL customer signed
 * in, was recognised, and was then asked to type the Emirates ID their sign-in
 * had just established.
 *
 * That is not a convenience. `epgl_licences_for_customer` deliberately prefers
 * the VERIFIED Emirates ID over anything the model supplies, because a registry
 * lookup keyed on a typed number returns whoever was typed rather than whoever
 * is signed in, and those are somebody's company records. With the verified one
 * the customer picks from their own companies instead of quoting a licence
 * number from memory.
 *
 * The Emirates Post branch has captured it since 18 September. This is the same
 * capture on the branch that verifies a signature, which never had it because
 * when it was written no host sent a signed token.
 *
 * Run from apps/web:  npx tsx scripts/test-jwt-emirates-id-2026-09-22.ts
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const hostToken = readFileSync(new URL("../lib/hostToken.ts", import.meta.url), "utf8");
const moe = readFileSync(new URL("../lib/moeLicences.ts", import.meta.url), "utf8");

/** The signed-token branch, which is the only part this change touches. */
const signed = route.slice(route.indexOf("if (looksSigned && hostTokenConfigured())"), route.indexOf("const usersBase = await epUsersBaseUrl"));

console.log("\nA verified token yields more than a subject");
check("the subject is still taken", /sub = v\.claims\.sub/.test(signed));
check("...and so is the Emirates ID", /verifiedEmiratesId =\s*\n?\s*typeof v\.claims\.emiratesId === "string"/.test(signed), signed.slice(0, 40));
check("an absent claim leaves it undefined, not an empty string", /: undefined;/.test(signed));
check("...and a blank one does too", /v\.claims\.emiratesId\.trim\(\)\s*\n?\s*\? v\.claims\.emiratesId\.trim\(\)/.test(signed));
check("the claim has somewhere to be declared", /emiratesId\?: string/.test(hostToken));

console.log("\nKept on the case, not just used for the turn");
check("it is written against the case", /rememberVerifiedEmiratesId\(session\.caseId, verifiedEmiratesId\)/.test(signed));
check("...only when there is one and a case to put it on", /if \(verifiedEmiratesId && session\.caseId\)/.test(signed));
// A sign-in that succeeded must not fail because a convenience write did.
check("...and a failure there never breaks the sign-in", /\.catch\(\(\) => \{\}\)/.test(signed));

console.log("\nWhich is the value the registry lookup prefers");
check("the tool reads the verified one first", /const signedInEid = str\(session\.state\.data\[VERIFIED_EID_KEY\]\)/.test(route));
check("...over anything the model passed", /const eid = signedInEid \?\? String\(input\.emiratesId \?\? ""\)/.test(route));

console.log("\nAnd punctuation is not our problem");
// UAE PASS gives idn as 784-XXXX-XXXXXXX-X. The lookup reduces to digits, so the
// claim is stored exactly as sent rather than reformatted into a shape that
// would then have to be un-reformatted somewhere else.
check("the registry normalises before it asks", /const eid = normaliseEmiratesId\(emiratesId\)/.test(moe));
check("...by stripping everything that is not a digit", /raw\.replace\(\/\\D\/g, ""\)/.test(moe));
check("...and insisting on fifteen of them", /\^\\d\{15\}\$/.test(moe));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
