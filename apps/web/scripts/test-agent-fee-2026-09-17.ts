/**
 * An agent fee on a card for a rental with no agent (demo, 17 September).
 *
 * "At the summary it showed 50 AED for the agent fee even though that step was
 * skipped. It didn't reflect it on the payment total but in the summary cost
 * total it showed it there."
 *
 * The 50 is real and it is not a charge: Emirates Post prices the AGENT line at
 * 50 and marks it serviceCriteria "I" — Inclusive — so the first agent is
 * already inside minimumAmount and only agents beyond the first cost anything.
 * The payment knew that. The card did not.
 *
 * Run from apps/web:  npx tsx scripts/test-agent-fee-2026-09-17.ts
 */
import { summaryFeeGuard, settleAgentRow, retotalAfterRemoval } from "../lib/summaryFee";
import { rentalTotal, agentCountFrom } from "../lib/rentalTotal";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

/** The card as the demo showed it: an agent line nobody asked for, in the total. */
const SKIPPED_CARD =
  "```summary\n" +
  "title: What you will pay\n" +
  "- PO Box: 450367\n" +
  "- Branch: Al Barsha Post Office\n" +
  "- Box rental: AED 300.00\n" +
  "- One-time registration fee: AED 70.00\n" +
  "- Authorised agent: AED 50.00\n" +
  "- Total: AED 420.00\n" +
  "```";

console.log("\nThe card from the demo");
{
  const { block, removed } = settleAgentRow(SKIPPED_CARD, false);
  check("the agent row is gone", !/Authorised agent/i.test(block), block);
  check("...and what it claimed is reported back", removed === 50, removed);
  check("the rental is untouched", /- Box rental: AED 300\.00/.test(block), block);
  check("so is the registration fee", /- One-time registration fee: AED 70\.00/.test(block), block);
  check("so are the box and the branch", /450367/.test(block) && /Al Barsha/.test(block), block);
  const fixed = retotalAfterRemoval(block, removed);
  check("and the total comes back to what the rows add up to", /Total: AED 370\.00/.test(fixed), fixed);
}

console.log("\nAn agent the customer DID add is still shown — without a price");
{
  const card = SKIPPED_CARD.replace("- Authorised agent: AED 50.00", "- Authorised agent (Nithya Rao): AED 50.00");
  const { block, removed } = settleAgentRow(card, true);
  check("the person stays on the card", /Nithya Rao/.test(block), block);
  check("the figure beside them goes", !/50\.00/.test(block.split("\n").find((l) => /Nithya/.test(l)) ?? ""), block);
  check("and says why", /No charge — the first agent is included/.test(block), block);
  check("the 50 is still reported as taken off the arithmetic", removed === 50, removed);
}

console.log("\nArabic");
{
  const ar = "```summary\ntitle: ما ستدفعه\n- إيجار الصندوق: 300.00 درهم\n- وكيل مفوّض: 50.00 درهم\n- Total: AED 350.00\n```";
  const { block, removed } = settleAgentRow(ar, true, "ar");
  check("the Arabic row is settled", /بدون رسوم/.test(block), block);
  check("...and its amount counted", removed === 50, removed);
  const gone = settleAgentRow(ar, false, "ar");
  check("an unnamed Arabic row is removed", !/وكيل مفوّض/.test(gone.block), gone.block);
}

console.log("\nThe card can name them before the case does");
{
  // collect_field and the card go out in the same response; nothing says which
  // lands first, and a name is worth more than a figure.
  const card = SKIPPED_CARD.replace("- Authorised agent: AED 50.00", "- Authorised agent (Nithya Rao): AED 50.00");
  const { block, removed } = settleAgentRow(card, /* the case does not know yet */ false);
  check("the person is not deleted with the price", /Nithya Rao/.test(block), block);
  check("but the price still goes", removed === 50 && !/Nithya Rao\): AED/.test(block), block);
}

console.log("\nWhat must NOT be touched");
for (const [what, card] of [
  ["a row that already says it is free", "```summary\n- Authorised agent (Nithya Rao): No charge — the first agent is included\n- Total: AED 370.00\n```"],
  ["the registration fee", "```summary\n- One-time registration fee: AED 70.00\n- Total: AED 370.00\n```"],
  ["key courier delivery", "```summary\n- Key courier delivery: AED 30.00\n- Total: AED 400.00\n```"],
  ["a bare fenced word", "```summary\nnothing here\n```"],
] as const) {
  const { block, removed } = settleAgentRow(card, true);
  check(`${what} is left alone`, block === card && removed === 0, { block, removed });
}

console.log("\nA SECOND agent is a real charge and stays");
{
  // extra > 0, so the caller never reaches settleAgentRow at all — asserted
  // through the streaming guard, which is where that decision is made.
  const g = summaryFeeGuard(
    () => null, () => null, () => true, () => ({}), "en", () => null,
    () => ({ extra: 1, named: true })
  );
  const card = "```summary\n- Box rental: AED 300.00\n- Second authorised agent: AED 50.00\n- Total: AED 350.00\n```";
  const out = g.push(card) + g.flush();
  check("the charge for a second agent survives", /Second authorised agent: AED 50\.00/.test(out), out);
  check("...and so does the total that includes it", /Total: AED 350\.00/.test(out), out);
}

console.log("\nThrough the streaming guard, a character at a time");
{
  const g = summaryFeeGuard(
    () => null, () => null, () => true, () => ({}), "en", () => null,
    () => ({ extra: 0, named: false })
  );
  let out = "";
  for (const c of `Here is what you will pay.\n\n${SKIPPED_CARD}\n\nShall I open the payment page?`) out += g.push(c);
  out += g.flush();
  check("the agent row never reaches the customer", !/Authorised agent/i.test(out), out);
  check("the corrected total does", /Total: AED 370\.00/.test(out), out);
  check("the prose around it is untouched", /Here is what you will pay\./.test(out) && /Shall I open the payment page\?/.test(out), out);
}

console.log("\nA total that never included the row is not 'corrected' into being wrong");
{
  const card =
    "```summary\n- Box rental: AED 300.00\n- One-time registration fee: AED 70.00\n- Authorised agent: AED 50.00\n- Total: AED 370.00\n```";
  const { block, removed } = settleAgentRow(card, false);
  const fixed = retotalAfterRemoval(block, removed);
  check("the already-correct total is left as it is", /Total: AED 370\.00/.test(fixed), fixed);
}

console.log("\nAnd the payment total was right all along");
{
  const charges = { base: 370, agentExtraPrice: 50, keyDeliveryPrice: 30 };
  check("no agent added → the hold, unchanged", rentalTotal(charges, { agentCount: agentCountFrom({}) }).total === 370);
  check("one agent added → still the hold, because the first is inclusive", rentalTotal(charges, { agentCount: 1 }).total === 370);
  check("two agents → one extra is charged", rentalTotal(charges, { agentCount: 2 }).total === 420);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
