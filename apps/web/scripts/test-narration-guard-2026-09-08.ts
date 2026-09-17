/**
 * The assistant thinking out loud in front of the customer (UAT, 8 September).
 *
 * Run from apps/web:  npx tsx scripts/test-narration-guard-2026-09-08.ts
 */
import { stripInternalNarration, isInternalNarration, narrationGuard } from "../lib/narrationGuard";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

console.log("\nThe reported sentences");
const reported = "The customer chose MyHome. I need to price both options: upgrade only (keeping current expiry 2031-09-05) and also prepare for upgrade + extend. Let me price the upgrade-only option first, and also fetch the renewed-by options.";
{
  const out = stripInternalNarration(`How long would you like to renew for?\n\n${reported}\n\nGreat news. Since you're upgrading to MyHome, here are your two options:`);
  check("the third-person customer goes", !/The customer chose/.test(out), out);
  check("the plan goes", !/I need to price both options/.test(out), out);
  check("the tool name goes", !/renewed-by options/.test(out), out);
  check("the question to the customer stays", /How long would you like to renew for\?/.test(out), out);
  check("and so does the good news", /Great news\./.test(out), out);
}
{
  const out = stripInternalNarration("Let me fetch the exact pricing for the upgrade.\n\nThe upgrade-only price for MyHome (keeping your current expiry of 05-09-2031) is AED 1,973.00. Let me get the pricing confirmed and the renewed-by options.");
  check("the price the customer needs survives", /AED 1,973\.00/.test(out), out);
  check("the second tool-name sentence goes", !/renewed-by options/.test(out), out);
  // Was "a plain progress note survives" until 17 September. The widget now
  // shows "Checking pricing…" beside the tool round itself, so the model saying
  // it too is the same news twice — and, from the mobile report, the thing that
  // splits a reply in half. See ANNOUNCED_WORK.
  check("the announcement of the lookup goes", !/Let me fetch the exact pricing/.test(out), out);
}

console.log("\nWhat must never be touched");
check("a summary block is untouched", stripInternalNarration("```summary\n- The customer: x\ntotal: AED 5\n```").includes("- The customer: x"));
check("card titles are untouched", stripInternalNarration("```cards\n- title: The customer plan\n```").includes("The customer plan"));
check("a pay block is untouched", stripInternalNarration("```pay\nurl: https://x/y\namount: AED 370.00\n```").includes("url: https://x/y"));
check("list rows are left alone", stripInternalNarration("- The customer reference is 12345").includes("The customer reference"));

console.log("\nOrdinary replies are not rewritten");
for (const t of [
  "Your box is reserved. Here is your total: AED 370.00.",
  "Which plan would you like?",
  "That pin is in Dubai, but your box is in Abu Dhabi.",
]) check(`"${t.slice(0, 42)}…"`, stripInternalNarration(t) === t, stripInternalNarration(t));

console.log("\nAnnouncing a lookup the widget is already showing (17 September)");
for (const gone of [
  "Let me fetch the branches for you.",
  "I'll bring up the payment now.",
  "Let me fetch the prices for each option.",
  "Let me pull up the details for box 566300 in Dubai right away.",
  "I'll check the renewal price for you.",
  "Let me look up your box.",
]) check(`gone: ${JSON.stringify(gone)}`, isInternalNarration(gone), gone);

console.log("\n...and the sentences that only look like one");
for (const kept of [
  // A promise about later, not a lookup happening now.
  "I'll get back to you once Emirates Post confirm it.",
  // Carries the answer as well as the preamble — over the length cap, so it stays.
  "Let me check the price, though it depends on which emirate the box is in and how long you renew for.",
  // Not a lookup at all.
  "I'll need their full name in English.",
  "Let me know if that is the right one.",
  "I'll send the receipt to the email on your account.",
]) check(`kept: ${JSON.stringify(kept.slice(0, 44))}…`, !isInternalNarration(kept), kept);

console.log("\nThe sentence test");
check("third person about the reader", isInternalNarration("The customer chose MyHome."));
check("...unless it is addressed to them", !isInternalNarration("The customer service team will call you back."));
check("our own tool names", isInternalNarration("Let me get the renewed-by options."));
check("planning aloud", isInternalNarration("I need to fetch the pricing first and also prepare the summary."));
check("a normal sentence is not", !isInternalNarration("Your renewal is confirmed."));

console.log("\nIt never empties a reply");
check("a reply that is ALL narration is kept as-is", stripInternalNarration(reported).trim().length > 0);
check("empty in, empty out", stripInternalNarration("") === "");

console.log("\nStreaming, which is the only way it helps");
/** Feed a reply through in awkward chunks, as a model actually emits it. */
const stream = (text: string, size = 7) => {
  const g = narrationGuard();
  let out = "";
  for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size));
  return out + g.flush();
};
{
  const full = `How long would you like to renew for?\n\n${reported}\n\nGreat news. Here are your two options:`;
  const out = stream(full);
  check("the narration never reaches the customer", !/The customer chose|I need to price|renewed-by options/.test(out), out);
  check("the question does", /How long would you like to renew for\?/.test(out), out);
  check("and the good news does", /Great news\./.test(out), out);
}
{
  const withCards = "Here are your plans.\n\n```cards\n- title: MyBox\n  price: AED 300\n```\n\nWhich would you like?";
  check("a fenced block survives streaming intact", stream(withCards).includes("- title: MyBox"), stream(withCards));
  check("...with its price", stream(withCards).includes("price: AED 300"));
  check("and the prose around it", /Which would you like\?/.test(stream(withCards)));
}
{
  const plain = "Your box is reserved. Here is your total: AED 370.00.";
  check("an ordinary reply streams through unchanged", stream(plain) === plain, stream(plain));
  check("...at any chunk size", stream(plain, 1) === plain && stream(plain, 999) === plain);
}
{
  const pay = "All set.\n\n```pay\nurl: https://paypage.example/v2?code=abc\namount: AED 370.00\n```";
  check("a pay block is never held back or altered", stream(pay).includes("url: https://paypage.example/v2?code=abc"), stream(pay));
}

/**
 * A plan withdrawn in front of the person it was announced to (16 September).
 *
 * "Since this is a Sole Establishment, there's no MOA needed. Next, I'll need
 * the Memorandum of Association — actually, scratch that, no MOA for a sole
 * establishment." The answer was in the first sentence; the second asks for a
 * document, takes it back, and repeats the reason.
 */
console.log("\nA reversal said out loud");
{
  const said =
    "Since this is a Sole Establishment, there's no MOA needed. " +
    "Next, I'll need the Memorandum of Association — actually, scratch that, no MOA for a sole establishment. " +
    "Let me ask about the region. Which area of Dubai is the office in?";
  const out = stream(said);
  check("the reversal is gone", !/scratch that/i.test(out), out);
  check("...and so is the document it took back", !/Next, I'll need the Memorandum/i.test(out), out);
  check("the announcement of a question is gone", !/Let me ask about/i.test(out), out);
  check("the question itself survives", /Which area of Dubai is the office in\?/.test(out), out);
  check("and the fact that settled it survives", /no MOA needed/.test(out), out);
}

console.log("\n...without taking honest sentences with it");
for (const kept of [
  "Let me know if that is the right one.",
  "Actually renting the box happens after payment.",
  "No MOA is needed for a sole establishment.",
  "Which area of Dubai is the office in?",
]) check(JSON.stringify(kept), stream(kept) === kept, stream(kept));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
