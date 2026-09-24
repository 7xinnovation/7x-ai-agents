/**
 * Emirates Post send their own confirmation, and a dead-end reply (2026-09-24).
 *
 * Two reports, one commit.
 *
 * 1. "The email template we have for the Emirates Post agent when purchase is
 *    complete is not needed any more — the APIs automatically send one out
 *    anyway." Two confirmations for one purchase is worse than one: the
 *    customer cannot tell which is authoritative and the references are
 *    formatted differently. EPGL send nothing, so theirs stays.
 *
 * 2. Every document was in, and the reply was "Next, the Memorandum of
 *    Association is optional but can help EPGL verify the company structure if
 *    you have it handy:" followed by the guard's "Already uploaded… Nothing to
 *    do here." The MOA was already on file, so the turn ended with no question,
 *    no control and nothing to press — the customer typed "already uploaded"
 *    to get the application moving again.
 *
 * Run from apps/web:  npx tsx scripts/test-completion-email-off-2026-09-24.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const prompt = readFileSync(new URL("../../../packages/core/src/ai/prompt.ts", import.meta.url), "utf8");

console.log("\nOne confirmation per purchase");
check("the send is skipped for the host that sends its own", /const hostSendsItsOwn = agent\.definition\.tenantSlug === "nxn"/.test(route));
check("...by having no recipient, so every other guard still applies", /const emailTo = hostSendsItsOwn \? null : completionRecipient/.test(route));
check("...and the gate itself is unchanged", /if \(purchase\?\.reference && !finalState\.confirmationEmailedAt && emailTo && emailConfigured\(\)\)/.test(route));
check("it is decided by tenant, not by a flag someone must remember", /whose backend is doing the emailing/.test(route));
// EPGL's confirmation is the only one a customer gets, so it must not be caught
// by this: the test that matters is that the condition names nxn and nothing else.
check("EPGL is not swept up in it", !/tenantSlug === "epgl"[\s\S]{0,80}emailTo/.test(route));

console.log("\nAnd a reply the customer can act on");
check("an already-uploaded document is not offered as optional either", /This holds for OPTIONAL documents too/.test(prompt));
check("...not even as \"if you have it handy\"", /if you have it handy/.test(prompt));
// The actual case: it had ASKED for the MOA earlier in the same conversation and
// been given it. That is the sentence that was missing.
check("...including one this conversation asked for and received", /when YOU asked for it earlier in this same conversation/.test(prompt));
check("realising it mid-ask is not a message of its own", /do not deliver that realisation as the message/.test(prompt));
check("...the reply continues to the next step instead", /CONTINUE to the next step in the same reply/.test(prompt));
check("a reply never ends on a statement about a document", /Never end a reply on a statement about a document/.test(prompt));
check("...and the reason is stated, not just the rule", /makes the customer type something just to restart you/.test(prompt));

console.log("\nAnd when it happens anyway, it is visible");
check("a suppressed ask is audited", /action: "upload_ask_suppressed"/.test(route));
check("...recording whether the customer was left anything to do", /endedWithNoAction/.test(route));
check("...and what the application was still waiting on", /missing: finalState\.readiness\.missing/.test(route));
// Appending the next pending document is NOT the repair: it is what caused the
// stray upload boxes of 15 September, prose naming one document and the control
// offering another.
check("the appender is still held off when the guard suppressed", /!uploadGuard\.suppressed\(\)/.test(route));
// The rule it extends has to survive: this is an addition, not a replacement.
check("the original 'do not ask again' rule is still there", /ALREADY UPLOADED — do NOT ask for these again/.test(prompt));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
