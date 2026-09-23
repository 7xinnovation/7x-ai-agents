/**
 * A session nobody signed out of still ends (2026-09-23).
 *
 * Reported against Emirates Post and true of both agents:
 *
 *   "When I signed in using my UAE PASS from another machine, there is no way to
 *   log out of that machine — the active session token remains, with the ability
 *   for anyone who is using it to sign in to the agent using my credentials."
 *
 * Signing out worked. What did not exist was an END to a session nobody signed
 * out of. `authenticated` was set once and never cleared — the resume path even
 * says so, "auth is sticky", and only ever moves it UP — while the conversation
 * id sits in that browser's localStorage. So the next person at that screen
 * resumed as the customer, with their verified Emirates ID, their boxes and
 * their company.
 *
 * Two limits, because one of them cannot do the job alone: IDLE ends the session
 * of somebody who walked away, and ABSOLUTE ends the session on a machine
 * somebody keeps using.
 *
 * Run from apps/web:  npx tsx scripts/test-session-expiry-2026-09-23.ts
 */
import { readFileSync } from "node:fs";
import { sessionExpired } from "../lib/conversation";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const conv = readFileSync(new URL("../lib/conversation.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

console.log("\nThe two limits");
check("a session used a minute ago is live",
  sessionExpired({ signedInAt: ago(5 * MIN), lastActivityAt: ago(MIN), now: NOW }) === null);
check("...and one idle for half an hour is not",
  sessionExpired({ signedInAt: ago(HOUR), lastActivityAt: ago(31 * MIN), now: NOW }) === "idle");
check("...just under the line still counts as live",
  sessionExpired({ signedInAt: ago(HOUR), lastActivityAt: ago(29 * MIN), now: NOW }) === null);
// The case idle cannot catch: a machine somebody keeps using all day.
check("a session in constant use still ends after twelve hours",
  sessionExpired({ signedInAt: ago(13 * HOUR), lastActivityAt: ago(MIN), now: NOW }) === "max_age");
check("...and eleven hours of it does not", sessionExpired({ signedInAt: ago(11 * HOUR), lastActivityAt: ago(MIN), now: NOW }) === null);
check("age is reported before idleness when both are past",
  sessionExpired({ signedInAt: ago(13 * HOUR), lastActivityAt: ago(2 * HOUR), now: NOW }) === "max_age");

console.log("\nWhat happens to sessions that predate this");
// Every conversation already in the database has no sign-in stamp. Treating
// those as expired on sight would sign out everyone the moment this ships;
// judging them on activity alone is both safe and quiet.
check("no stamp and recent activity is left alone", sessionExpired({ lastActivityAt: ago(MIN), now: NOW }) === null);
check("no stamp and no activity for an hour still expires", sessionExpired({ lastActivityAt: ago(60 * MIN), now: NOW }) === "idle");
check("nothing known at all is not an expiry", sessionExpired({ now: NOW }) === null);

console.log("\nWhat ending one actually does");
check("the limits are read from the environment", /SESSION_IDLE_MINUTES/.test(conv) && /SESSION_MAX_MINUTES/.test(conv));
check("the resume path checks before it trusts the flag", /expiredAs = sessionExpired\(/.test(conv));
check("...and only for a session that was signed in", /if \(effectiveAuth\) \{/.test(conv));
check("it signs the conversation out for real", /signOutConversation\(conv\.id\)/.test(conv));
check("...which is what clears the token, the flag and the identity", /sessionToken: null, authenticated: false, userRef: null/.test(conv));
check("the stored token is not handed to this turn either", /const stored = expiredAs \? \{\} : readSessionToken/.test(conv));
check("nor is the userRef the client sent", /userRef: expiredAs \? undefined :/.test(conv));
// The case was read a moment BEFORE the sign-out landed, so the copy in hand
// still carries what the database no longer does.
check("...nor the verified values on the case in hand", /state: expiredAs \? withoutIdentity\(caseRow!\.state\) :/.test(conv));
check("withoutIdentity drops all three", /delete data\[VERIFIED_EID_KEY\][\s\S]{0,200}delete data\[VERIFIED_ACCOUNT_KEY\][\s\S]{0,120}delete data\[AUTH_AT_KEY\]/.test(conv));
check("it is recorded", /action: "session_expired"/.test(conv));

console.log("\nAnd the application survives it");
// Only who is holding the case goes. A customer part-way through a rental comes
// back to their answers, not to a blank form.
check("the case itself is not cleared", !/emptyCase\(\)[\s\S]{0,200}expiredAs/.test(conv));
check("the sign-in clock is stamped when they sign in", /\[AUTH_AT_KEY\]: new Date\(\)\.toISOString\(\)/.test(conv));
check("...best-effort, never failing the sign-in", /if \(c\) await mutateCase[\s\S]{0,200}catch \{/.test(conv));

console.log("\nThe customer is told, twice over");
check("the reply explains it", /THE CUSTOMER WAS SIGNED OUT BEFORE THIS MESSAGE/.test(route));
check("...as a security measure, not as their mistake", /not as a fault of theirs/.test(route));
check("...and does not re-ask for what is already collected", /must NOT be asked for again once they are back/.test(route));
check("...and does not reach for tools it can no longer use", /do not call those tools/.test(route));
check("the header is told on the session event", /\.\.\.\(session\.expired \? \{ expired: session\.expired \} : \{\}\)/.test(route));
check("...and the widget acts on it", /if \(ev\.expired\) \{/.test(exp));
check("...dropping the token it was holding", /uaePass\.current = undefined;\s*\n\s*nativeIdentity\.current = false;\s*\n\s*setAuthenticated\(false\);/.test(exp));
check("...in both languages", /انتهت جلستك لعدم النشاط/.test(exp));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
