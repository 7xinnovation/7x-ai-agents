/**
 * Regression test for the reissued-payment-link overcharge (QA, 13 Aug 2026).
 *
 * A customer chose branch pickup (AED 300), switched to delivery (AED 325),
 * opened the payment link, closed the tab by accident and asked for another one.
 * The new link was AED 350 — the courier fee charged twice for one delivery.
 *
 * Cause: request_payment added the fee to the amount the MODEL passed. The first
 * call passes the base (300 -> 325). The second call passes the total it just
 * quoted (325 -> 350), and a third would be 375. The fee must only ever be added
 * to the journey's configured price, never to a figure that may already contain it.
 *
 *   npx tsx scripts/test-payment-amount.ts
 */
import { chargeableAmount } from "@dialog/core";

const RENTAL = {
  action: "crm.createCase",
  requiresPayment: true,
  amount: 300,
  currency: "AED",
  surcharges: [
    { key: "key_delivery_fee", label: { en: "Courier fee", ar: "رسوم التوصيل" }, amount: 25, when: "key_delivery == 'deliver'" },
  ],
} as never;

const DELIVER = { key_delivery: "deliver" };
const PICKUP = { key_delivery: "branch_pickup" };

let pass = 0, fail = 0;
const eq = (name: string, got: number, want: number) => {
  if (got === want) { pass++; console.log(`  PASS  ${name} → AED ${got}`); }
  else { fail++; console.log(`  FAIL  ${name} → AED ${got}, expected ${want}`); }
};

// The exact sequence from QA.
eq("pickup selected", chargeableAmount(RENTAL, PICKUP, 300), 300);
eq("switched to delivery", chargeableAmount(RENTAL, DELIVER, 300), 325);
eq("link reissued — model passes the total it quoted", chargeableAmount(RENTAL, DELIVER, 325), 325);
eq("reissued again", chargeableAmount(RENTAL, DELIVER, 350), 325);
eq("reissued a fourth time", chargeableAmount(RENTAL, DELIVER, 325), 325);

// Switching back must drop the fee, not keep it.
eq("delivery reverted to pickup", chargeableAmount(RENTAL, PICKUP, 325), 300);

// A journey priced by a backend tool (no surcharges) must still honour the
// authoritative figure the pricing tool returned.
const PRICED = { action: "crm.createCase", requiresPayment: true, currency: "AED", surcharges: [] } as never;
eq("backend-priced journey keeps the tool's amount", chargeableAmount(PRICED, DELIVER, 1595), 1595);

console.log(fail ? `\n${fail} FAILED` : `\nAll ${pass} payment-amount checks passed.`);
process.exit(fail ? 1 : 0);
