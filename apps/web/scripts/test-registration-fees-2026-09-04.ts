/**
 * The registration fee read back out of a real Rental/Select response.
 *
 * Run from apps/web:  npx tsx scripts/test-registration-fees-2026-09-04.ts
 */
import { feesInSelectResponse } from "../lib/registrationFees";

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
};

// Trimmed from the audited 4 Sep response for hold 260612175 (MyHome, AED 765).
const real = `HTTP 200 OK
${JSON.stringify({
  payload: {
    subscriptionReferenceNumber: "260612175",
    minimumAmount: 765.0,
    priceDetails: [
      { bundleID: "MYHOME3", serviceType: "AGENT", serviceCriteria: "I", totalAmount: 50.0, priceDetailItems: [{ amount: 16.5, year: "2026" }] },
      { bundleID: "MYHOME3", serviceType: "AGENT", serviceCriteria: "A", totalAmount: 50.0, priceDetailItems: [{ amount: 33.5, year: "2027" }] },
      { bundleID: "MYHOME3", serviceType: "RENT", serviceCriteria: "M", totalAmount: 695.0, priceDetailItems: [{ amount: 226.75, year: "2026" }] },
      { bundleID: "MYHOME3", serviceType: "NEW-REG", serviceCriteria: "M", totalAmount: 70.0, priceDetailItems: [{ amount: 70.0, year: "2026" }] },
    ],
  },
})}`;

eq("the fee, from the NEW-REG line", [...feesInSelectResponse(real)], [["MYHOME3", 70]]);
eq("no NEW-REG, no figure", [...feesInSelectResponse(`HTTP 200 OK\n${JSON.stringify({ payload: { priceDetails: [{ bundleID: "IN", serviceType: "RENT", totalAmount: 300 }] } })}`)], []);
eq("an unreadable body invents nothing", [...feesInSelectResponse("HTTP 200 OK\nnot json at all")], []);

// The audit truncates a write at 4000 characters, so the body can arrive as
// invalid JSON. The NEW-REG line must still be readable out of the text.
const truncated = real.slice(0, real.indexOf('"NEW-REG"') + 120);
eq("truncated mid-response", [...feesInSelectResponse(truncated)], [["MYHOME3", 70]]);

// The nested priceDetailItems each carry their own `amount` — reading one of
// those instead of totalAmount is how a fee of 16.50 would reach a card.
const nestedFirst = `HTTP 200 OK\n${JSON.stringify({
  payload: { priceDetails: [{ bundleID: "IN", serviceType: "NEW-REG", priceDetailItems: [{ amount: 16.5 }], totalAmount: 70.0 }] },
})}`;
eq("the total, not a monthly slice", [...feesInSelectResponse(nestedFirst)], [["IN", 70]]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
