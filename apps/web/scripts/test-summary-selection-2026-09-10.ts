/**
 * A summary that leaves out the box and the branch is a summary of the wrong thing.
 *
 * Emirates Post reported it twice on 10 September as two separate bugs — "the
 * P.O. Box number and location were selected during the rental journey, but
 * these details are not displayed in the Selection Summary", and "the selected
 * P.O. Box details are not displayed for review and confirmation before
 * proceeding with the payment". Asked for it directly, the assistant produced a
 * complete card with PO Box 392028 and Al Quoz Fourth Branch on it. Nothing was
 * missing from the case; it was missing from the card.
 *
 * Run from apps/web:  npx tsx scripts/test-summary-selection-2026-09-10.ts
 */
import { insertSelectionRows, summaryFeeGuard } from "../lib/summaryFee";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n${String(got)}`}`); }
};

const CARD = [
  "```summary",
  "- Package: MyBox",
  "- Emirate: Dubai",
  "- Duration: 1 year",
  "- Key collection: Collect from branch (free)",
  "- Registration fee: AED 70.00",
  "- Box rental (1 year): AED 300.00",
  "total: AED 370.00",
  "```",
].join("\n");

console.log("\nThe purchase itself goes in");
{
  const out = insertSelectionRows(CARD, { boxNumber: "392028", branch: "Al Quoz Fourth Branch" });
  check("the box number appears", /- PO Box: 392028/.test(out), out);
  check("the branch appears", /- Branch: Al Quoz Fourth Branch/.test(out), out);
  check("both sit ABOVE the money", out.indexOf("392028") < out.indexOf("Registration fee"), out);
  check("the total is untouched", /total: AED 370\.00/.test(out), out);
  check("the card is still a card", out.startsWith("```summary") && out.trimEnd().endsWith("```"), out);
}

console.log("\nNothing is duplicated or overwritten");
{
  const already = CARD.replace("- Emirate: Dubai", "- Emirate: Dubai\n- PO Box: 111111\n- Branch: Naif Post Office");
  const out = insertSelectionRows(already, { boxNumber: "392028", branch: "Al Quoz Fourth Branch" });
  check("a card that already has them is left alone", out === already, out);
  // If the card and the case disagree that is a real problem; hiding it here
  // would be worse than showing it.
  check("...even when they disagree with the case", /111111/.test(out) && !/392028/.test(out), out);
}
{
  const arabic = "```summary\n- الباقة: صندوقي\n- الإمارة: دبي\n- الصندوق: 2290\n- الفرع: فرع دبي الرئيسي\n```";
  check("an Arabic card's own rows are recognised", insertSelectionRows(arabic, { boxNumber: "2290", branch: "فرع دبي الرئيسي" }, "ar") === arabic);
}
{
  const arabic = "```summary\n- الباقة: صندوقي\n- الإمارة: دبي\n```";
  const out = insertSelectionRows(arabic, { boxNumber: "2290", branch: "فرع دبي الرئيسي" }, "ar");
  check("an Arabic card gets Arabic labels", /- الصندوق: 2290/.test(out) && /- الفرع: فرع دبي الرئيسي/.test(out), out);
}

console.log("\nWhat it must not touch");
{
  check("nothing known, nothing added", insertSelectionRows(CARD, {}) === CARD);
  check("a blank value is not a value", insertSelectionRows(CARD, { boxNumber: "   ", branch: null }) === CARD);
  const bare = "```summary\nNothing chosen yet.\n```";
  check("a card with no rows is not rewritten", insertSelectionRows(bare, { boxNumber: "1", branch: "X" }) === bare);
  const unclosed = "```summary\n- Package: MyBox";
  check("an unclosed fence is left as text", insertSelectionRows(unclosed, { boxNumber: "1", branch: "X" }) === unclosed);
}
{
  // Only the box is known -- the branch comes later in the journey.
  const out = insertSelectionRows(CARD, { boxNumber: "392028" });
  check("a half-known selection adds only what is known", /- PO Box: 392028/.test(out) && !/- Branch:/.test(out), out);
}

console.log("\nThrough the streaming guard, in awkward chunks");
{
  const g = summaryFeeGuard(() => null, () => null, () => true, () => ({ boxNumber: "392028", branch: "Al Quoz Fourth Branch" }));
  let out = "";
  const text = `Here is your summary.\n\n${CARD}\n\nShall I reserve it?`;
  for (let i = 0; i < text.length; i += 5) out += g.push(text.slice(i, i + 5));
  out += g.flush();
  check("the rows survive streaming", /- PO Box: 392028/.test(out) && /- Branch: Al Quoz Fourth Branch/.test(out), out);
  check("the prose around the card is intact", /Here is your summary\./.test(out) && /Shall I reserve it\?/.test(out), out);
}
{
  const g = summaryFeeGuard(() => null, () => null, () => true, () => ({}));
  let out = "";
  const text = `No card here at all, just a sentence about a PO Box.`;
  for (const ch of text) out += g.push(ch);
  out += g.flush();
  check("a message with no card passes byte for byte", out === text, out);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
