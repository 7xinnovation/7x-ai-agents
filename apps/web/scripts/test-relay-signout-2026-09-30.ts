/**
 * Signing out of the chat clears what the relay is holding (2026-09-30).
 *
 * "The token does not get disabled so it's still signed in on
 * box.emiratespost.ae. I thought we were doing this?"
 *
 * We were not, and it is worth being exact about what was built and what was
 * not. Signing out ended OUR session and stopped the relay's token being taken
 * BACK INTO the widget. It never touched the host page: the mirror cookie
 * stayed, and the site's own token — which is the site's session, not ours —
 * was never in scope.
 *
 * The widget has always announced it: { source: "dialog", action: "signed-out" }
 * posted to the parent. Nothing listened.
 *
 * Two different things, treated differently:
 *
 *   - the mirror COOKIE is ours. Keeping our own copy of somebody's token after
 *     they sign out is indefensible, so it goes every time.
 *   - the site's TOKEN signs them out of the whole website. That is a
 *     reasonable policy and it is the site owner's to adopt, not a side effect
 *     of embedding a chat widget. Opt-in: data-signout-clears-host="1".
 *
 * Run from apps/web:  npx tsx scripts/test-relay-signout-2026-09-30.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const relay = readFileSync(new URL("../public/dialog-relay.js", import.meta.url), "utf8");
const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");

console.log("\nThe widget has always said so");
check("it posts signed-out to the host page", /postMessage\(\{ source: "dialog", action: "signed-out" \}, "\*"\)/.test(exp));

console.log("\nAnd now the relay listens");
check("it is wired up", /window\.addEventListener\("message", onAssistantMessage\);/.test(relay));
check("...matching the message it sends", /m\.source !== "dialog" \|\| m\.action !== "signed-out"/.test(relay));
// A page that can post to us could otherwise sign the customer out of the site
// it is embedded in.
check("...only from the assistant's own origin", /if \(!ASSISTANT \|\| e\.origin !== ASSISTANT\) return;/.test(relay));

console.log("\nOur cookie goes every time");
check("cleared unconditionally", /if \(canCookie\) clear\(\);/.test(relay));
// Otherwise the next poll re-posts a token the customer just signed out of.
check("...and the last posted token is forgotten with it", /posted = null;/.test(relay));

console.log("\nThe site's own token only where the site asked");
check("off unless opted in", /var SIGNOUT_CLEARS_HOST = String\(d\.signoutClearsHost \|\| ""\) === "1";/.test(relay));
check("...and then removed", /window\.localStorage\.removeItem\(TOKEN_KEY\);/.test(relay));
check("...with storage that throws handled, as everywhere else here", /catch \(err\) \{/.test(relay));
// Silence would be the worst outcome: the site owner never learns the option
// exists, and the customer stays signed in with no trace of why.
check("...and a note saying the option exists when it is off", /Add data-signout-clears-host/.test(relay));

console.log("\nDocumented where somebody installing it will read it");
check("the attribute is in the attribute list", /data-signout-clears-host/.test(relay.slice(0, relay.indexOf("(function ()"))));
check("...and the reasoning has its own section", /\* SIGNING OUT/.test(relay));
check("...saying plainly whose session is whose", /the token in localStorage is the SITE'S/.test(relay));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
