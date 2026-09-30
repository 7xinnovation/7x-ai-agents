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
// The list it removes defaults to exactly TOKEN_KEY — see the CLEAR_KEYS
// assertions below, which is where this moved when the portal turned out to
// keep the name in a second key as well.
check("...and then removed", /window\.localStorage\.removeItem\(CLEAR_KEYS\[i\]\);/.test(relay));
check("...with storage that throws handled, as everywhere else here", /catch \(err\) \{/.test(relay));
// Silence would be the worst outcome: the site owner never learns the option
// exists, and the customer stays signed in with no trace of why.
check("...and a note saying the option exists when it is off", /Add data-signout-clears-host/.test(relay));

console.log("\nDocumented where somebody installing it will read it");
check("the attribute is in the attribute list", /data-signout-clears-host/.test(relay.slice(0, relay.indexOf("(function ()"))));
check("...and the reasoning has its own section", /\* SIGNING OUT/.test(relay));
check("...saying plainly whose session is whose", /the token in localStorage is the SITE'S/.test(relay));

console.log("\nA sign-out can also arrive as a page load, for the un-embedded widget");
/**
 * postMessage reaches the relay only while the assistant is embedded in the
 * host page. Opened on its own at agent.7x.ae the parent is itself, so on
 * production — where the portal is the only door — a sign-out reached the
 * portal's session not at all, and the next Sign in came straight back as the
 * same person. The window our side opens is the other half of this.
 */
check("the relay acts on dlg-signout in the URL", /function signoutRequested\(\)/.test(relay));
check("...matching it in the query or the hash", /dlg-signout\(=\|&\|\$\)/.test(relay));
check("...under the same opt-in, because a URL is not permission", /var cleared = clearHost\(\);/.test(relay));
check("...and one clearHost serves both routes", /function clearHost\(\)/.test(relay) && /^\s*clearHost\(\);$/m.test(relay));
check("...telling the opener which happened", /action: "host-signed-out", cleared: cleared/.test(relay));
check("...only to the assistant's origin", /window\.opener\.postMessage\(\s*\{[^}]*\},\s*ASSISTANT\s*\)/.test(relay));

console.log("\nAnd the site can name the other keys its session lives in");
check("extra keys are configurable", /d\.signoutClearsKeys/.test(relay));
check("...defaulting to the token alone", /if \(!CLEAR_KEYS\.length\) CLEAR_KEYS = \[TOKEN_KEY\];/.test(relay));
check("...and all of them are removed", /window\.localStorage\.removeItem\(CLEAR_KEYS\[i\]\)/.test(relay));

console.log("\nThe widget opens that window, where the portal is the only door");
check("only when the portal is the door", /if \(agent\.hostLoginUrl && !agent\.uaePassOwnFlow\) \{/.test(exp));
// A sign-in page asked to sign somebody out signs them back in.
check("...on the site root, not the sign-in page", /\$\{origin\}\/\?dlg-signout=1/.test(exp));
check("...from hostLoginUrl's origin", /origin = new URL\(agent\.hostLoginUrl\)\.origin/.test(exp));
check("...and it is closed from this side", /name: "dlg-host-signout"/.test(exp) && /host\.close\(\)/.test(exp));
check("a refusal is reported rather than swallowed", /declined: the relay tag there needs data-signout-clears-host/.test(exp));
check("...and only that origin is believed", /if \(e\.origin !== origin\) return;/.test(exp));

console.log("\nAnd the snippet the admin panel hands over carries it");
/**
 * Emirates Post installed the tag exactly as this panel printed it —
 * data-domain and nothing else — so the sign-out attribute was a default they
 * took without being shown it, and three rounds of "sign out is still not
 * working" came out of one missing line.
 */
const editor = readFileSync(new URL("../app/admin/[slug]/Editor.tsx", import.meta.url), "utf8");
check("the opt-in is in the snippet itself", /data-signout-clears-host="1"><\/script>/.test(editor));
check("...with the consequence written under it", /signs the customer out of <em>this website<\/em>/.test(editor));
check("...and the multi-key form shown", /data-signout-clears-keys=&quot;accessToken,profile&quot;/.test(editor));
// Sign-in page only was right when this was about handing a token over. It is
// wrong now: the page-load sign-out can only be answered where the tag is.
check("...and it says to install it sitewide", /Put it on every page, not only the sign-in one/.test(editor));
check("...naming the marker that reaches it there", /\?dlg-signout=1/.test(editor));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
