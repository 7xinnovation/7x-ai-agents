/**
 * The duplicated renewal message (mobile app bug list, 11 September, issue 7).
 *
 * Run from apps/web:  npx tsx scripts/test-echo-guard-2026-09-17.ts
 */
import { echoGuard } from "../lib/echoGuard";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

/** Stream it the way the model writes it, in awkward pieces. */
function stream(text: string, size = 7): string {
  const g = echoGuard();
  let out = "";
  for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size));
  return out + g.flush();
}

console.log("\nThe reported reply, verbatim");
const REPORTED =
  "Your box expired on 21-08-2026, so the renewal runs from the current date forward. " +
  "How long would you like to renew for? Let me fetch the prices for each option.\n\n" +
  "Your box expired on 21-08-2026, so the renewal runs from today forward. " +
  "The longer options carry a discount. Choose your renewal period:\n\n" +
  "```cards\n- title: 1 Year\n  note: Renews to 21-08-2027\n  price: AED 300.00\n" +
  "- title: 2 Years\n  note: Renews to 21-08-2028\n  price: AED 600.00\n```";
{
  const out = stream(REPORTED);
  check("the explanation is said once", (out.match(/renewal runs from/g) ?? []).length === 1, out);
  check("the FIRST wording is the one kept", /from the current date forward/.test(out), out);
  check("...and the second is gone", !/from today forward/.test(out), out);
  check("the question the customer has to answer survives", /How long would you like to renew for\?/.test(out), out);
  check("so does the sentence that is genuinely new", /The longer options carry a discount\./.test(out), out);
  check("and so does the instruction", /Choose your renewal period:/.test(out), out);
}

console.log("\nCards are not prose and must never be deduplicated");
{
  // Five duration cards differ by two characters each. Every one belongs.
  const cards =
    "Here are your options.\n\n```cards\n" +
    ["1 Year", "2 Years", "3 Years", "5 Years", "10 Years"]
      .map((t, i) => `- title: ${t}\n  note: New expiry: 20-12-${2036 + i}\n  price: AED ${300 * (i + 1)}.00`)
      .join("\n") +
    "\n```";
  const out = stream(cards);
  check("all five cards survive", (out.match(/- title:/g) ?? []).length === 5, out);
  check("the block is byte-identical", out === cards, out);
}

console.log("\nA price list is a list, not an echo");
{
  const list =
    "These are the branches that have boxes free.\n" +
    "- Dubai Sorting Centre — AED 300.00 a year\n" +
    "- Karama Post Office — AED 300.00 a year\n" +
    "- Deira Post Office — AED 300.00 a year\n";
  check("every row survives", stream(list) === list, stream(list));
}

console.log("\nShort sentences repeat in ordinary writing");
for (const t of [
  "Yes. Yes.",
  "Which one? Which one?",
  "Thank you. Thank you.",
  "Done. Done.",
]) check(JSON.stringify(t), stream(t) === t, stream(t));

console.log("\nSentences that share a subject are not the same sentence");
{
  const t =
    "Your box expires on 21-08-2027 and auto-renewal is currently off. " +
    "Your box is held at the Dubai Sorting Centre in Al Quoz. " +
    "Would you like me to turn auto-renewal on?";
  check("all three survive", stream(t) === t, stream(t));
}

console.log("\nAcross replies is not across a reply");
{
  const line = "Your box expired on 21-08-2026, so the renewal runs from the current date forward.";
  check("a new guard per turn says it again", stream(line) === line && stream(line) === line, stream(line));
}

console.log("\nIt never changes a reply that does not repeat itself");
for (const t of [
  "Your box is reserved. Here is your total: AED 370.00. I will send the receipt to the email on your account.",
  "Adding an authorised agent to PO Box 566300 (Dubai) costs AED 56.00, prorated to the box's current expiry.",
  "```pay\nurl: https://x/y\namount: AED 370.00\n```",
  "",
]) check(JSON.stringify(t.slice(0, 44)), stream(t) === t, stream(t));

console.log("\nThe Arabic side of the same reply");
{
  const ar =
    "انتهت صلاحية صندوقك في 21-08-2026، لذا يبدأ التجديد من تاريخ اليوم. كم مدة التجديد التي ترغب بها؟ " +
    "انتهت صلاحية صندوقك في 21-08-2026، لذا يبدأ التجديد من تاريخ اليوم. اختر مدة التجديد:";
  const out = stream(ar);
  check("the Arabic repeat goes too", (out.match(/انتهت صلاحية صندوقك/g) ?? []).length === 1, out);
  check("the new instruction stays", /اختر مدة التجديد:/.test(out), out);
}

console.log("\nNothing is lost: what goes out is a subset of what came in");
{
  const g = echoGuard();
  let out = "";
  for (const c of REPORTED) out += g.push(c);
  out += g.flush();
  check("one character at a time gives the same answer", out === stream(REPORTED, 7), out);
  check("the guard reports what it dropped", g.dropped() >= 1, g.dropped());
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
