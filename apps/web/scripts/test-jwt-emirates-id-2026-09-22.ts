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
const conv = readFileSync(new URL("../lib/conversation.ts", import.meta.url), "utf8");

/** The signed-token branch, which is the only part this change touches. */
const signed = route.slice(route.indexOf("if (looksSigned && hostTokenConfigured())"), route.indexOf("const usersBase = await epUsersBaseUrl"));

console.log("\nA verified token yields more than a subject");
check("the subject is still taken", /sub = v\.claims\.sub/.test(signed));
check("...and so is the Emirates ID", /verifiedEmiratesId = claim\("emiratesId"\)/.test(signed));
// One reader for every claim, so "present but blank" cannot mean one thing for
// the Emirates ID and another for the email.
check("claims are read through one helper", /const claim = \(k: string\): string \| undefined/.test(signed));
check("an absent claim is undefined, never an empty string",
  /typeof raw === "string" && raw\.trim\(\) \? raw\.trim\(\) : undefined/.test(signed));
check("...and a blank one is too, with the whitespace gone", /raw\.trim\(\) \? raw\.trim\(\)/.test(signed));
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

console.log("\nAnd the rest of what the token already told us");
// Read out of a real EPGL token: name, email, accountId, contactId, userId.
// All of it was dropped, so a signed-in applicant was asked for a name and an
// email address by an assistant holding both.
check("the name and email become a verified identity", /verifiedIdentity = \{ name: claim\("name"\), email: claim\("email"\) \}/.test(signed));
check("...which is the shape contactSeed already takes", /contactSeed\(session\.state, verifiedIdentity\)/.test(route));
check("...seeded only where the customer has not answered already", /if \(name && !filled\(data, NAME_KEYS\)\) seed\.contact_name = name/.test(readFileSync(new URL("../lib/knownContact.ts", import.meta.url), "utf8")));
check("no mobile is invented — the token carries none", !/mobile: claim/.test(signed));

console.log("\nThe account, standing in for the Emirates ID until it arrives");
check("it is captured from the token", /const accountId = claim\("accountId"\)/.test(signed));
check("...and kept on the case", /rememberVerifiedAccountId\(session\.caseId, accountId\)/.test(signed));
check("the case has a key for it", /export const VERIFIED_ACCOUNT_KEY/.test(conv));
check("...that only accepts a Salesforce id", /SF_ID\.test\(id\)/.test(conv));
check("it travels to a new chat, like the Emirates ID", /VERIFIED_EID_KEY, VERIFIED_ACCOUNT_KEY\]/.test(conv));
check("...and is dropped on sign-out, like the Emirates ID", /delete data\[VERIFIED_ACCOUNT_KEY\]/.test(conv));
check("a tool reads the company from it", /if \(name === MY_COMPANY_TOOL\)/.test(route));
// A lookup the model can aim is a lookup that returns whoever it was aimed at.
check("...taking NO argument from the model", /name: MY_COMPANY_TOOL,[\s\S]{0,1800}?input_schema: \{ type: "object", properties: \{\}, required: \[\] \}/.test(route));
check("...reading the account off the case, not the input", /const accountId = str\(session\.state\.data\[VERIFIED_ACCOUNT_KEY\]\)/.test(route));
check("...and running it past the blocklist like every other company read", /if \(name === MY_COMPANY_TOOL\)[\s\S]{0,1200}?blockedNotice\(found\)/.test(route));
check("no company on the account is a normal answer, not an error", /NOT LINKED TO A COMPANY RECORD/.test(route));
check("the model is told to call it first", /Call \$\{MY_COMPANY_TOOL_NAME\} FIRST/.test(route));
check("...and never to read an account id out to the customer", /never state or repeat an account id/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
