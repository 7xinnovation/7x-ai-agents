/**
 * Which penalties a renewal charges for, and which it only mentions.
 *
 * Emre's decision, 15 September: collect the APPROVED ones with the licence
 * fee, state the rest. EPGL's own process map has the step ("System calculates
 * renewal fees and penalties if any" → "Client makes payment accordingly");
 * what it does not say is which of seven penalty states counts as owed, and
 * getting that wrong charges a customer for a figure the regulator has not
 * approved.
 *
 * Run from apps/web:  npx tsx scripts/test-penalties-2026-09-15.ts
 */
import { splitPenalties, penaltyNotice, penaltyLabel, type EpglPenalty } from "../lib/epglRead";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

let seq = 0;
const p = (status: string, paymentStatus: string | undefined, amount: number, type = "Form-9 Non Submission"): EpglPenalty =>
  ({ id: `a${seq++}`, type, quarter: "Q1", year: "2026", amount, status, paymentStatus });

console.log("\nOnly Approved is chargeable — the picklist has seven values");
{
  // Every status their org uses, each with an outstanding payment state.
  const all = [
    p("Approved", "Draft", 1000),
    p("Draft", "Draft", 2000),
    p("On Hold", "Draft", 4000),
    p("Submitted For Approval", "Draft", 8000),
    p("Rejected", "Draft", 16000),
    p("Cancelled", "Draft", 32000),
    p("Paid", "Draft", 64000),
  ];
  const s = splitPenalties(all);
  check("Approved is charged", s.chargeableTotal === 1000, s.chargeableTotal);
  check("Draft, On Hold and Submitted are pending, not charged", s.pendingTotal === 2000 + 4000 + 8000, s.pendingTotal);
  check("Rejected, Cancelled and Paid are neither", s.chargeable.length === 1 && s.pending.length === 3, s);
}

console.log("\nAnd the PAYMENT state decides whether it is still owed");
{
  for (const [state, owed] of [["Draft", true], ["Open", true], [undefined, true], ["Paid", false], ["Cancelled", false], ["Rejected", false], ["Under verification", false]] as const) {
    const s = splitPenalties([p("Approved", state as string | undefined, 5000)]);
    check(`payment "${state ?? "(empty)"}" → ${owed ? "charged" : "not charged"}`, (s.chargeableTotal === 5000) === owed, s.chargeableTotal);
  }
  check("a zero-amount penalty is ignored", splitPenalties([p("Approved", "Open", 0)]).chargeable.length === 0);
}

console.log("\nCEO approval is NOT the gate");
{
  // Measured in their org: false on all 223 approved penalties. Gating on it
  // would collect nothing, ever, while appearing to work.
  const s = splitPenalties([p("Approved", "Open", 18000)]);
  check("an approved penalty is charged without CEO approval", s.chargeableTotal === 18000);
}

console.log("\nTotals are money, so they add up exactly");
{
  const s = splitPenalties([p("Approved", "Open", 1291150.57825), p("Approved", "Draft", 293646.0053)]);
  check("no floating-point tail", String(s.chargeableTotal) === String(Math.round(s.chargeableTotal * 100) / 100), s.chargeableTotal);
}

console.log("\nWhat the agent is told");
{
  const s = splitPenalties([p("Approved", "Draft", 18000), p("Draft", "Draft", 5000, "Renewal")]);
  const n = penaltyNotice(s)!;
  check("the approved total is named", n.includes("AED 18,000"), n);
  check("...and said to be added to the payment", /ADDED TO THE RENEWAL PAYMENT/.test(n));
  check("...before the customer pays", /BEFORE they pay/.test(n));
  check("...with the card already containing it", /already includes them/.test(n));
  check("...and the model forbidden its own total", /do NOT work out your own total/.test(n));
  check("the unapproved one is named separately", n.includes("AED 5,000") && /NOT charged/.test(n), n);
  check("...and must not be added", /Never add them to the total/.test(n));
  check("each line says what it is for", n.includes("Form-9 Non Submission (Q1 2026)"), n);
}
{
  check("nothing outstanding says nothing", penaltyNotice(splitPenalties([])) === null);
  check("and a null split says nothing", penaltyNotice(null) === null);
  const onlyPending = penaltyNotice(splitPenalties([p("Draft", "Draft", 900)]))!;
  check("pending alone never claims to be charged", !/ADDED TO THE RENEWAL PAYMENT/.test(onlyPending), onlyPending);
}
check("a penalty with no period still reads", penaltyLabel({ id: "x", amount: 1, type: "Non Compliance" }) === "Non Compliance");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
