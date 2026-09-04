/**
 * The pay card's AMOUNT, not just its URL.
 *
 * Run from apps/web:  npx tsx scripts/test-payfence-amount-2026-09-04.ts
 */
import { payFenceGuard } from "../lib/payFence";

let pass = 0, fail = 0;
const eq = (name: string, got: string, want: string) => {
  if (got === want) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};
const run = (text: string, url: string | null, amount: number | null, chunk = 1000) => {
  const g = payFenceGuard(() => url, () => amount);
  let out = "";
  for (let i = 0; i < text.length; i += chunk) out += g.push(text.slice(i, i + chunk));
  return out + g.flush();
};

const URL_ = "https://paypage.sandbox.ngenius-payments.com/v2?code=c45e4fce57e8b54";

// The reported bug: the gateway asked for 670, the card said 700.
eq("a wrong amount is corrected",
  run("Pay here:\n```pay\nurl: " + URL_ + "\namount: AED 700.00\n```\nThanks.", URL_, 670),
  "Pay here:\n```pay\nurl: " + URL_ + "\namount: AED 670.00\n```\nThanks.");

eq("a right amount is left alone",
  run("```pay\nurl: " + URL_ + "\namount: AED 670.00\n```", URL_, 670),
  "```pay\nurl: " + URL_ + "\namount: AED 670.00\n```");

eq("a missing amount is added",
  run("```pay\nurl: " + URL_ + "\n```", URL_, 670),
  "```pay\nurl: " + URL_ + "\namount: AED 670.00\n```");

eq("no authoritative amount, nothing invented",
  run("```pay\nurl: " + URL_ + "\namount: AED 700.00\n```", URL_, null),
  "```pay\nurl: " + URL_ + "\namount: AED 700.00\n```");

eq("no order, no button",
  run("```pay\nurl: " + URL_ + "\namount: AED 700.00\n```", null, 670),
  "\n_The payment link is not ready yet — the order still has to be created with Emirates Post._\n");

eq("a wrong url is still corrected, with the amount",
  run("```pay\nurl: https://example.com/evil\namount: AED 700.00\n```", URL_, 670),
  "```pay\nurl: " + URL_ + "\namount: AED 670.00\n```");

// Streamed a byte at a time, the way the customer actually reads it.
for (const size of [1, 3, 7, 40]) {
  eq(`chunk ${size}`,
    run("Pay:\n```pay\nurl: " + URL_ + "\namount: AED 700.00\n```\nok", URL_, 670, size),
    "Pay:\n```pay\nurl: " + URL_ + "\namount: AED 670.00\n```\nok");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
