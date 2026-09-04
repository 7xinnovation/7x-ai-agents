/**
 * The registration fee is a ROW in the summary card, not a sentence under it.
 *
 * Run from apps/web:  npx tsx scripts/test-summary-fee-2026-09-04.ts
 */
import { summaryFeeGuard, insertRegistrationFee } from "../lib/summaryFee";

let pass = 0, fail = 0;
const eq = (name: string, got: string, want: string) => {
  if (got === want) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};
const run = (text: string, fee: number | null, chunk = 1000) => {
  const g = summaryFeeGuard(() => fee);
  let out = "";
  for (let i = 0; i < text.length; i += chunk) out += g.push(text.slice(i, i + chunk));
  return out + g.flush();
};

// The card Emirates Post saw: everything but the money.
const card = "```summary\ntitle: New PO Box summary\n- Bundle: MyBox\n- Box number: 450413\n- Duration: 1 year\n```";
eq("the row is added",
  run("Here's your summary:\n" + card + "\nSet your preferences:", 70),
  "Here's your summary:\n```summary\ntitle: New PO Box summary\n- Bundle: MyBox\n- Box number: 450413\n- Duration: 1 year\n- One-time registration fee: AED 70.00\n```\nSet your preferences:");

eq("above an existing total",
  run("```summary\n- Box rental: AED 300.00\ntotal: AED 400.00\n```", 70),
  "```summary\n- Box rental: AED 300.00\n- One-time registration fee: AED 70.00\ntotal: AED 400.00\n```");

eq("a card that already names it is untouched",
  run("```summary\n- Box rental: AED 300.00\n- Registration fee: AED 70.00\n```", 70),
  "```summary\n- Box rental: AED 300.00\n- Registration fee: AED 70.00\n```");

eq("no fee known, nothing invented", run(card, null), card);
eq("a fenced block with no rows is not a summary", run("```summary\ntitle: Nothing yet\n```", 70), "```summary\ntitle: Nothing yet\n```");
eq("other blocks pass through", run("```cards\n- title: MyBox\n```", 70), "```cards\n- title: MyBox\n```");
eq("plain prose passes through", run("No card here at all.", 70), "No card here at all.");

// Streamed, the way the customer reads it.
for (const size of [1, 2, 5, 17]) {
  eq(`chunk ${size}`,
    run("Summary:\n" + card + "\nok", 70, size),
    "Summary:\n```summary\ntitle: New PO Box summary\n- Bundle: MyBox\n- Box number: 450413\n- Duration: 1 year\n- One-time registration fee: AED 70.00\n```\nok");
}

// An unclosed fence is text, and must not be eaten.
eq("an unclosed block survives", run("```summary\n- Bundle: MyBox", 70), "```summary\n- Bundle: MyBox");
eq("two cards both get the row",
  run(card + "\n\n" + card, 70).split("One-time registration fee").length - 1 + "",
  "2");
eq("direct helper: no rows, no row added", insertRegistrationFee("```summary\ntitle: x\n```", 70), "```summary\ntitle: x\n```");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
