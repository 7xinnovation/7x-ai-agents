/**
 * Reading the gateway's verdict on an order.
 *
 * The shapes below are the real N-Genius sandbox responses for outlet
 * b78ef8c7…, 4 Sep: order 260972862, which the customer paid, and 260972872,
 * which they believed they had paid.
 *
 * Run from apps/web:  npx tsx scripts/test-gateway-order-2026-09-04.ts
 */
import { readOrder } from "../lib/gatewayOrder";

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};

const purchased = {
  _embedded: { payment: [{
    state: "PURCHASED",
    amount: { currencyCode: "AED", value: 76500 },
    paymentMethod: { name: "VISA", pan: "411111******1111" },
    authResponse: { resultCode: "00", resultMessage: "Successful approval/completion" },
  }] },
};
const failed = {
  _embedded: { payment: [{
    state: "FAILED",
    amount: { currencyCode: "AED", value: 67000 },
    paymentMethod: { name: "VISA", pan: "411111******1111" },
    "3ds2": { eci: "05", transStatus: "Y" },
  }] },
};

eq("a settled payment", readOrder(purchased), {
  state: "PURCHASED", paid: true, reason: null, card: "VISA 411111******1111", untouched: false,
});
eq("a decline the customer believed had gone through", readOrder(failed), {
  state: "FAILED",
  paid: false,
  reason: "The bank did not approve the payment. No reason was given.",
  card: "VISA 411111******1111",
  untouched: false,
});
eq("a decline that names itself",
  readOrder({ _embedded: { payment: [{ state: "FAILED", authResponse: { resultCode: "05", resultMessage: "Do not honour" } }] } }).reason,
  "Do not honour (05)");
eq("nobody has tried to pay", readOrder({ _embedded: { payment: [] } }), {
  state: null, paid: false, reason: null, card: null, untouched: true,
});
eq("an order with no payment block at all", readOrder({}).untouched, true);
eq("the LAST attempt is the one being asked about",
  readOrder({ _embedded: { payment: [{ state: "FAILED" }, { state: "PURCHASED" }] } }).paid, true);
eq("authorised counts as paid", readOrder({ _embedded: { payment: [{ state: "AUTHORISED" }] } }).paid, true);
eq("still on the page is not a failure", readOrder({ _embedded: { payment: [{ state: "STARTED" }] } }), {
  state: "STARTED", paid: false, reason: null, card: null, untouched: false,
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
