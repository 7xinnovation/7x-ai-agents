/**
 * The multi-year price comes from a reservation, never from multiplication.
 *
 * Measured against staging on 6 Sep: MyBox five years is AED 1,200, not 300 x 5.
 * MyHome ten years is 4,000, not 6,950. Emirates Post publishes null for every
 * multi-year field on the personal bundles, so the only honest sources are the
 * published figure (corporate has one) and what has actually been charged.
 *
 * Run from apps/web:  npx tsx scripts/test-observed-rents-2026-09-06.ts
 */
import { rentInSelectResponse, rentKey } from "../lib/registrationFees";

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};

const made = new Date("2026-09-06T08:00:00Z");
const select = (bundleID: string, expiry: string, rent: number) =>
  `HTTP 200 OK\n${JSON.stringify({
    payload: {
      subscriptionReferenceNumber: "260612200",
      minimumAmount: rent + 70,
      poBoxExpiryDate: expiry,
      priceDetails: [
        { bundleID, serviceType: "AGENT", serviceCriteria: "I", totalAmount: 250 },
        { bundleID, serviceType: "RENT", serviceCriteria: "M", totalAmount: rent },
        { bundleID, serviceType: "NEW-REG", serviceCriteria: "M", totalAmount: 70 },
      ],
    },
  })}`;

// The three real observations that showed the multiplication was wrong.
eq("MyBox, five years, is 1200 and not 1500",
  [...rentInSelectResponse(select("IN", "2031-09-05T00:00:00+00:00", 1200), made)],
  [[rentKey("IN", 5), 1200]]);
eq("MyHome, ten years, is 4000 and not 6950",
  [...rentInSelectResponse(select("MYHOME3", "2036-09-05T00:00:00+00:00", 4000), made)],
  [[rentKey("MYHOME3", 10), 4000]]);
eq("MyHome Instant, five years, is 4000 and not 4975",
  [...rentInSelectResponse(select("MYHOMEF", "2031-09-05T00:00:00+00:00", 4000), made)],
  [[rentKey("MYHOMEF", 5), 4000]]);
// One year, where multiplication and the truth agree.
eq("MyBox, one year, is the annual rate",
  [...rentInSelectResponse(select("IN", "2027-09-05T00:00:00+00:00", 300), made)],
  [[rentKey("IN", 1), 300]]);

console.log("\nWhat must NOT be learned");
eq("no expiry, no observation", [...rentInSelectResponse(`HTTP 200 OK\n${JSON.stringify({ payload: { priceDetails: [{ bundleID: "IN", serviceType: "RENT", totalAmount: 300 }] } })}`, made)], []);
eq("no RENT line, no observation", [...rentInSelectResponse(select("IN", "2027-09-05T00:00:00+00:00", 0), made)], []);
eq("an unreadable body invents nothing", [...rentInSelectResponse("HTTP 200 OK\nnot json", made)], []);
eq("a date in the past is not a term",
  [...rentInSelectResponse(select("IN", "2020-01-01T00:00:00+00:00", 300), made)], []);
eq("twenty-one years is not a term Emirates Post offers",
  [...rentInSelectResponse(select("IN", "2047-09-05T00:00:00+00:00", 300), made)], []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
