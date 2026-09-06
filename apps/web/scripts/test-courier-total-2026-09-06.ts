/**
 * The card is asked what it is selling (2026-09-06).
 *
 * A five-year MyBox at Al Barsha listed "Key courier delivery: AED 30.00" and
 * was footed at AED 1,270 — the reservation's minimumAmount, which is the box
 * alone. The payment page then asked for 1,300, which was correct: Emirates Post
 * did price the courier on that hold, and the save added it. The card was the
 * only thing that did not know, because the customer's choice had reached the
 * conversation and never the case.
 *
 * So the total is now computed from what the card itself lists, priced by the
 * reservation. And where the reservation does NOT price key delivery, the row
 * comes off rather than being charged for.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-courier-total-2026-09-06.ts
 */
import { summaryFeeGuard, extrasNamedIn, dropCourier } from "@/lib/summaryFee";
import { rentalTotal } from "@/lib/rentalTotal";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};
const run = (guard: ReturnType<typeof summaryFeeGuard>, text: string) => {
  let out = "";
  for (const ch of text) out += guard.push(ch); // a byte at a time: it is a stream
  return out + guard.flush();
};

/** Box 450735, verbatim in shape: the card that said 1,270 over lines worth 1,300. */
const CARD = [
  "Box 450735 is held. Here is what you will pay:",
  "",
  "```summary",
  "- Box rental (5 years): AED 1,200.00",
  "- One-time registration fee: AED 70.00",
  "- Key courier delivery: AED 30.00",
  "total: AED 1270.00",
  "```",
  "",
  "The payment page will open on your saved Visa.",
].join("\n");

// ── what the card says it is selling ────────────────────────────────────────
check("a priced courier row is a courier", extrasNamedIn(CARD).keyDelivery);
check("a card without one is not", !extrasNamedIn("```summary\n- Box rental: AED 400.00\ntotal: AED 470.00\n```").keyDelivery);
check(
  "the choice stated as a choice counts too",
  extrasNamedIn("```summary\n- Key delivery: Courier (AED 30 — Emirates Post will call)\ntotal: AED 1.00\n```").keyDelivery
);
check(
  "collecting from the branch is NOT a courier",
  !extrasNamedIn("```summary\n- Key delivery: Collect from the branch\ntotal: AED 1.00\n```").keyDelivery
);

// ── the reported card, priced by the reservation ────────────────────────────
const hold = { base: 1270, agentExtraPrice: 50, keyDeliveryPrice: 30 };
const guard = summaryFeeGuard(
  () => 70,
  (extras) => rentalTotal(hold, { agentCount: 1, keyDelivery: extras.keyDelivery }).total,
  () => true
);
const fixed = run(guard, CARD);
check("the total becomes the 1,300 the gateway will ask for", /total: AED 1300\.00/.test(fixed), fixed);
check("...and the courier row is still there, because it is real", /Key courier delivery: AED 30\.00/.test(fixed));
check("the rows above it are untouched", /Box rental \(5 years\): AED 1,200\.00/.test(fixed));

// ── the same card on a reservation that prices no courier ───────────────────
const unpriced = summaryFeeGuard(
  () => 70,
  (extras) => rentalTotal({ base: 1270, keyDeliveryPrice: null }, { agentCount: 1, keyDelivery: extras.keyDelivery }).total,
  () => false
);
const stripped = run(unpriced, CARD);
check("a courier Emirates Post does not sell comes off the card", !/Key courier delivery/i.test(stripped), stripped);
check("...and is not in the total either", /total: AED 1270\.00/.test(stripped), stripped);

check(
  "the choice row is rewritten, not left saying courier",
  /Key delivery: Collect from the branch/.test(
    dropCourier("```summary\n- Key delivery: Courier (AED 30 — they will call)\n- Key courier delivery: AED 30.00\ntotal: AED 1300.00\n```")
  )
);

// ── nothing else moves ──────────────────────────────────────────────────────
const before = summaryFeeGuard(() => 70, () => null, () => true);
const pre = run(before, "```summary\n- Box rental: AED 400.00\n- Key courier delivery: AED 30.00\n```");
check("with no reservation yet, the card keeps its own arithmetic", !/total:/i.test(pre), pre);
check("...and still gains the registration fee", /registration fee: AED 70\.00/.test(pre));

const plain = summaryFeeGuard(() => 70, () => 500, () => true);
check("prose outside a card is never touched", run(plain, "Hello. No card here at all.") === "Hello. No card here at all.");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
