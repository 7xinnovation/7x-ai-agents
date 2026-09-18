/**
 * 115 USER_PROFILE_INVALID — the rental that died at the payment step.
 *
 * 18 September, from the mobile app. The box was reserved, the summary was
 * right, and Rental/Save came back:
 *
 *   {"errorDetails":{"RESPONSE_CODE":"115","RESPONSE_MESSAGE":"SYSTEM ERROR:
 *    PLEASE CONTACT SUPPORT TEAM","ERROR_CODE":"115",
 *    "ERROR_MESSAGE":"USER_PROFILE_INVALID"}}
 *
 * Against the save that had worked the day before, the payload differed by one
 * field: `userProfile.idNumber`. Their check is PRESENCE, not validity — the
 * save that succeeded carried the literal string "784-XXXX-XXXXXXX-X", a
 * placeholder the model typed, and Emirates Post wrote it into a real
 * subscription record without complaint.
 *
 * So two things were wrong and only one of them was visible: a rental completed
 * or failed on whether the model happened to have an identity in front of it,
 * and when it did not it invented one.
 *
 * Run from apps/web:  npx tsx scripts/test-rental-identity-2026-09-18.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const integrations = read("../lib/integrations.ts");
const route = read("../app/api/chat/route.ts");
const handoff = read("../app/api/embed/handoff/route.ts");
const conversation = read("../lib/conversation.ts");

console.log("\nWhat counts as an Emirates ID");
// Lifted from the patch so the test breaks if the rule drifts.
const src = /const plausible = (\(v: string\) => [^;]+);/.exec(integrations);
check("the rule is where the test thinks it is", Boolean(src), src?.[1]);
const plausible: (v: string) => boolean = eval(src![1]!.replace(": string", ""));

for (const [what, v, want] of [
  ["a real one, dashed", "784-1996-7889087-6", true],
  ["a real one, bare", "784199678890876", true],
  ["the placeholder that got through", "784-XXXX-XXXXXXX-X", false],
  ["an empty field", "", false],
  ["a masked one", "784-****-*******-*", false],
  ["an email in the slot", "emre.karayalcin@hotmail.com", false],
  ["too short", "784199678", false],
  ["right length, wrong country prefix", "123199678890876", false],
  ["a name", "Emre Karayalcin", false],
] as const) {
  check(`${what}: ${JSON.stringify(v)}`, plausible(v) === want, plausible(v));
}

console.log("\nThe save stamps it rather than trusting the model");
const patch = integrations.slice(integrations.indexOf("WHO THE SUBSCRIPTION IS FOR"), integrations.indexOf("Did these company details come from"));
check("it only runs on a rental save", /if \(\/rental_save\$\/i\.test\(toolName\)\)/.test(integrations));
check("a value the model wrote is kept when it is real", /if \(!plausible\(written\)\)/.test(patch), patch.slice(0, 80));
check("otherwise the verified id is substituted", /u\.idNumber = verified\.replace/.test(patch));
check("...and the substitution is audited", /rental_save_identity_corrected/.test(patch));
check("what was overwritten is recorded as a SHAPE, not a value", /replace\(\/\\d\/g, "#"\)/.test(patch), patch.match(/input: \{ wrote[^}]*\}/)?.[0]);
check("with no verified id the call is refused", /REFUSED LOCALLY: this rental cannot be saved/.test(patch));
check("...and the model is told not to invent one", /Do NOT invent an id/.test(patch));
check("...and that nothing has been charged", /Nothing has been charged/.test(patch));
check("...and the refusal is audited too", /rental_save_identity_missing/.test(patch));

console.log("\nThe identity is kept at every sign-in that learns one");
check("the app's handoff remembers it", /rememberVerifiedEmiratesId\(session\.caseId, emiratesId\)/.test(handoff));
check("...which it never did before, and is the only place that can", /emiratesId = v\.identity\.emiratesId/.test(handoff));
check("a host-page sign-in remembers it on the turn it verifies", /rememberVerifiedEmiratesId\(session\.caseId, verifiedEmiratesId\)/.test(route));
check("and a session that predates all that resolves it lazily", /const resolveEmiratesId = async/.test(route));
check("...from the token held against the conversation", /const stored = backendSessionToken \?\? uaePassIdentityToken/.test(route));
check("...writing back what it finds", /rememberVerifiedEmiratesId\(session\.caseId, found\)/.test(route));
check("...and only for a signed-in customer", /if \(!stored \|\| !session\.authenticated\) return \(eidResolved = null\)/.test(route));
check("the resolver reaches the save", /verifiedEmiratesId: agent\.definition\.tenantSlug === "nxn" \? resolveEmiratesId/.test(route));

console.log("\nOnly a real Emirates ID is ever stored");
check("the store normalises to digits", /replace\(\/\\D\/g, ""\)/.test(conversation));
check("...and refuses anything that is not fifteen of them", /if \(!\/\^\\d\{15\}\$\/\.test\(digits\)\) return;/.test(conversation));

console.log("\nThe failure is not reported as a payment");
// The response note that goes back with a failed save, unchanged — it was
// already right, and the customer's screenshot shows the agent following it.
check("a failed save says no money moved", /NO ORDER WAS CREATED AND NO MONEY HAS MOVED/.test(integrations));
check("...and keeps the reservation alive", /Their reservation is still held/.test(integrations));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
