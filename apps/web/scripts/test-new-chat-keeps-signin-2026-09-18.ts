/**
 * "Refreshing the chat window prompts the user to sign in again" — item 10,
 * looked at a second time.
 *
 * The first pass changed the icon, which was right: the control starts a NEW
 * CHAT and a circular arrow told the customer it was a reload. Then it handled
 * the native handoff, where the app can mint another sign-in code.
 *
 * The app is not on that path. It signs in with UAE PASS, and a UAE PASS
 * session leaves nothing in the widget at all — the token is stored server-side
 * against the CONVERSATION, deliberately out of the page's reach. So
 * `uaePass.current` was empty, `nativeIdentity` was false, and the customer was
 * dropped to guest exactly as reported. The half that mattered was unfixed.
 *
 * Run from apps/web:  npx tsx scripts/test-new-chat-keeps-signin-2026-09-18.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const conversation = read("../lib/conversation.ts");
const route = read("../app/api/embed/continue/route.ts");
const exp = read("../app/embed/[agent]/Experience.tsx");

// From the doc comment, because half of what is being asserted is the reasoning.
const carry = conversation.slice(conversation.indexOf("A NEW CONVERSATION FOR A CUSTOMER"), conversation.indexOf("Sign a conversation out"));

console.log("\nThe session moves; the application does not");
check("there is a carry", /export async function carrySessionForward/.test(conversation));
check("it takes the agent as well as the id", /carrySessionForward\(\s*agentId: string,\s*fromConversationId: string/.test(conversation));
check("...and will not cross agents", /eq\(conversations\.agentId, agentId\)/.test(carry));
check("it refuses a conversation that was never signed in", /if \(!from \|\| !\(from\.authenticated && from\.sessionToken\)\) return null;/.test(carry));
check("the token is copied as stored, never decrypted", /sessionToken: from\.sessionToken/.test(carry) && !/decryptSecret/.test(carry));
check("the verified subject travels", /userRef: from\.userRef/.test(carry));
check("so does the Emirates ID", /VERIFIED_EID_KEY\]: eid/.test(carry));
check("but the case starts empty", /const fresh = emptyCase\(\)/.test(carry));
check("...which is what 'new chat' means", /everything\s+\*?\s*that says WHO, and nothing that says what they were doing/.test(carry.replace(/\n \* /g, " ")), carry.slice(0, 40));

console.log("\nThe endpoint");
check("it is a POST taking { agent, from }", /body: \{ agent\?: string; from\?: string \}/.test(route));
check("an unknown agent is a 404", /"unknown_agent" \}, \{ status: 404 \}/.test(route));
check("everything else is one 401", /"no_session" \}, \{ status: 401 \}/.test(route));
check("...and says why that is deliberate", /Which of those it was is ours to know/.test(route));
check("it never returns the token", !/sessionToken/.test(route));

console.log("\nWhy this is not a new capability, written down");
check(
  "the reasoning is in the code, not only in a commit",
  /conversation id is already a session\s+bearer/i.test(carry.replace(/\n \* /g, " ")),
  carry.slice(0, 60)
);
// The claim has to be true, so assert the thing it rests on: getOrCreateSession
// takes an id and reads authentication off the row.
const gocs = conversation.slice(conversation.indexOf("if (input.conversationId) {"), conversation.indexOf("// New session."));
check("...and it is true: an id alone loads the session", /const effectiveAuth = conv\.authenticated \|\| claimedAuth \|\| Boolean\(conv\.sessionToken\)/.test(gocs));
check("...including the stored token", /readSessionToken\(conv\.sessionToken\)/.test(gocs));

console.log("\nWhat the widget does on a new chat");
const reset = exp.slice(exp.indexOf("const resetChat = useCallback"), exp.indexOf("The app answering"));
check("a host-page token still needs nothing", /if \(uaePass\.current\) return;/.test(reset));
check("a guest is simply a guest", /if \(!wasSignedIn \|\| !leaving\) \{ setAuthenticated\(false\); return; \}/.test(reset));
check("a signed-in customer has their session carried", /fetch\("\/api\/embed\/continue"/.test(reset));
check("...to the conversation they were just in", /from: leaving/.test(reset));
check("the new conversation is remembered", /window\.localStorage\.setItem\(storageKey, data\.conversationId\)/.test(reset));
check("the app's handoff is the fallback, not the first answer", reset.indexOf("/api/embed/continue") < reset.indexOf("signin-needed"));
check("and only then is the header told they are signed out", /nativeIdentity\.current = false;\s*setAuthenticated\(false\);/.test(reset));
check("the control no longer looks like reload", /<NotePencil size=\{16\}/.test(exp));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
