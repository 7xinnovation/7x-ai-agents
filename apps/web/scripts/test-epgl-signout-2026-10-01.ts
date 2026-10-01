/**
 * EPGL's sign-out ends a Salesforce session, not a localStorage key (2026-10-01).
 *
 * "For EPGL sign out, if we update the script to do the same stuff will it work
 * for that one too if I provide it to the developer?"
 *
 * Not on its own. Emirates Post keep their session in `localStorage`, so the
 * relay can clear it once the site opts in. EPGL's portal is Salesforce
 * Experience Cloud and keeps its session in an HttpOnly `sid` cookie — no
 * script of ours reaches that from any origin. The same attribute would have
 * cleared the handover token, left the customer signed in to the community, and
 * looked identical from the outside.
 *
 * So the sign-out gained a third hop, in the same window: clear the host's
 * storage, visit the portal's own logout, end the UAE PASS session.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-signout-2026-10-01.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../../packages/config/src/agent.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../app/embed/[agent]/types.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/embed/[agent]/page.tsx", import.meta.url), "utf8");
const script = readFileSync(new URL("./epgl-host-logout-2026-10-01.ts", import.meta.url), "utf8");

console.log("\nThe portal's own logout is configuration, not a special case in the code");
check("it is in the schema", /hostLogoutUrl: z\.string\(\)\.url\(\)\.optional\(\),/.test(schema));
check("...saying why a second mechanism exists at all", /HttpOnly `sid` cookie, which no script\s*\n\s*\* of ours can touch/.test(schema));
check("...and in the widget's contract", /hostLogoutUrl\?: string;/.test(types));
check("...reaching it", /hostLogoutUrl: d\.hostLogoutUrl,/.test(page));

console.log("\nAnd the sign-out visits it, in the middle");
check("a hop of its own", /const toHostLogout = \(win: ExternalWindow \| null\) => \{/.test(exp));
// Navigated, never fetched: a cookie on their origin only goes when the browser
// is sent there.
check("...navigated, not fetched", /win\.navigate\(agent\.hostLogoutUrl\);/.test(exp));
// The portal's reply is what moves the window on, so the storage is cleared
// before the logout page is ever visited.
check("...after the host's storage is cleared", /window\.clearTimeout\(timer\);\s*\n\s*toHostLogout\(win\);/.test(exp));
check("...and before UAE PASS", /window\.setTimeout\(\(\) => toUaePass\(win\), 2000\);/.test(exp));
// Emirates Post has no such endpoint — there the storage IS the session — so an
// agent without one must go straight on rather than stall.
check("skipped where the portal has none", /if \(!agent\.hostLogoutUrl \|\| !win\) \{ toUaePass\(win\); return; \}/.test(exp));

console.log("\nThe URL is derived from where they sign in");
/**
 * Staging signs in at the epro--preprod2 sandbox and production at app.epgl.ae.
 * A logout URL pasted from the wrong environment is a sign-out that silently
 * does nothing — or one that ends a session on the other system.
 */
check("origin taken from hostLoginUrl", /const want = `\$\{new URL\(login\)\.origin\}\/secur\/logout\.jsp`;/.test(script));
check("...and refuses where there is no portal", /has no hostLoginUrl here, so there is no portal to sign out of/.test(script));
check("...idempotent", /\(already\) hostLogoutUrl/.test(script));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
