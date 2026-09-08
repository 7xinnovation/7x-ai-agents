/**
 * Changing what an agent can call must leave a trace.
 *
 * On 8 September, Rental/Select was enabled:false in production. The model was
 * never handed the reservation tool, no hold could exist, and every PO Box
 * rental was refused at the payment step. The last working reservation was
 * 6 September at 19:06 — and there was no way to find out what turned it off,
 * when, or who by, because none of the three ways to change an integration
 * wrote anything down.
 *
 * Run from apps/web:  npx tsx scripts/test-integration-audit-2026-09-08.ts
 */
export {};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const { readFileSync } = await import("node:fs");
const route = readFileSync(new URL("../app/api/admin/agents/[slug]/integrations/route.ts", import.meta.url), "utf8");
const helper = readFileSync(new URL("./lib/auditOps.ts", import.meta.url), "utf8");
const script = readFileSync(new URL("./nxn-enable-rental-ops-2026-09-08.ts", import.meta.url), "utf8");

const section = (name: string) => {
  const i = route.indexOf(`export async function ${name}(`);
  const rest = route.slice(i + 1);
  const next = rest.search(/export async function |^const \w+Body/m);
  return i === -1 ? "" : rest.slice(0, next === -1 ? undefined : next);
};

console.log("\nEvery mutation writes a row");
for (const m of ["POST", "PATCH", "DELETE"] as const) {
  check(`${m} audits`, /await audit\(\{/.test(section(m)), section(m).length);
}
check("GET does not — reads are not changes", !/await audit\(\{/.test(section("GET")));

console.log("\nThe row says who");
check("the admin's identity is read from their session", /verifySession\(\(await cookies\(\)\)\.get\("dlg_admin"\)/.test(route));
check("an unreadable session is 'unknown', never a crash", /catch \{\s*return "unknown";/.test(route));
check("every row carries it", (route.match(/by: await whoami\(\)/g) ?? []).length === 3, (route.match(/by: await whoami\(\)/g) ?? []).length);

console.log("\nThe row says what changed, not just what it is now");
check("the toggle reads the previous value FIRST", /const before = \(await listIntegrations\(agent\.id\)\)[\s\S]{0,200}?await setIntegrationEnabled/.test(route));
check("...and records both sides", /was: before\?\.enabled \?\? null,\s*now: parsed\.data\.enabled/.test(route));
check("enable and disable are distinct actions", /integration_enabled" : "integration_disabled/.test(route));

console.log("\nA re-import is the dangerous one, and is treated that way");
const post = section("POST");
check("the previous operations are read before being replaced", /const prevEnv = \(await listIntegrations\(agent\.id\)\)[\s\S]{0,260}?await upsertEnvironment/.test(post));
check("tools it silently re-enabled are NAMED", /reEnabled: wasDisabled\.filter/.test(post));
check("tools it newly disabled are named", /newlyDisabled: nowDisabled\.filter/.test(post));
check("tools that vanished from the spec are named", /removedTools:/.test(post));
check("a first import reads differently from a re-import", /prevEnv \? "integration_spec_reimported" : "integration_imported"/.test(post));

console.log("\nDeleting is a change too");
const del = section("DELETE");
check("what was deleted is read before it goes", /const doomed = \(await listIntegrations\(agent\.id\)\)[\s\S]{0,200}?deleteEnvironment/.test(del));
check("one environment and a whole integration are distinguished", /integration_environment_deleted" : "integration_deleted/.test(del));

console.log("\nScripts bypass the route, so they get their own");
check("a shared helper exists", /export async function auditOperationFlags/.test(helper));
check("it names the script that made the change", /by: `script:\$\{input\.script\}`/.test(helper));
check("it never fails the run it is recording", /catch \{[\s\S]{0,120}?\}/.test(helper));
check("it writes nothing when nothing changed", /if \(!input\.enabled\?\.length && !input\.disabled\?\.length\) return;/.test(helper));
check("the reservation fix uses it", /auditOperationFlags\(db, \{/.test(script));
check("and only once the change is actually written", /await db\.update\(agentIntegrations\)[\s\S]{0,340}?auditOperationFlags/.test(script));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
