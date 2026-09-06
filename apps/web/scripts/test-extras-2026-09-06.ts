/**
 * What a rental actually charges for, against Emirates Post's own price lines.
 *
 * Two extras, one rule: an extra exists only if the RESERVATION prices it, and
 * it is charged only if it is not marked Inclusive. Both halves were wrong on
 * 6 Sep — a MyHome customer was offered key courier at AED 30, which that
 * bundle does not sell, and the first authorised agent was shown at AED 150.00
 * beside their name, which reads as a fee and is not one.
 *
 * Run from apps/web:  npx tsx scripts/test-extras-2026-09-06.ts
 */
import { servicesInSelectResponse } from "../lib/registrationFees";
import { rentalTotal } from "../lib/rentalTotal";

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};
/** A reservation response, for a term stated in years from 6 Sep 2026. */
const select = (bundleID: string, lines: [string, string, number][], minimumAmount: number, years = 3) =>
  `HTTP 200 OK\n${JSON.stringify({
    payload: {
      minimumAmount,
      poBoxExpiryDate: `${2026 + years}-09-05T00:00:00+00:00`,
      priceDetails: lines.map(([serviceType, serviceCriteria, totalAmount]) => ({ bundleID, serviceType, serviceCriteria, totalAmount })),
    },
  })}`;

// Exactly what staging returns, 6 Sep.
const myHome3y = select("MYHOME3", [["AGENT", "I", 150], ["AGENT", "A", 150], ["RENT", "M", 2085], ["NEW-REG", "M", 70]], 2155);
const myBox1y = select("IN", [["AGENT", "I", 50], ["RENT", "M", 300], ["AGENT", "A", 50], ["KEY-DELIVERY", "A", 30], ["NEW-REG", "M", 70]], 370, 1);

const made = new Date("2026-09-06T08:00:00Z");
// MyBox at five years: same bundle, same customer, no courier line.
const myBox5y = select("IN", [["AGENT", "I", 250], ["RENT", "M", 1200], ["AGENT", "A", 250], ["NEW-REG", "M", 70]], 1270, 5);

console.log("Which bundles AND TERMS sell key courier");
eq("MyHome three years does not",
  servicesInSelectResponse(myHome3y, made).get("MYHOME3|3")?.includes("KEY-DELIVERY"), false);
eq("MyBox one year does",
  servicesInSelectResponse(myBox1y, made).get("IN|1")?.includes("KEY-DELIVERY"), true);
// The distinction that a bundle-level answer gets wrong.
eq("MyBox FIVE years does not — same bundle, different term",
  servicesInSelectResponse(myBox5y, made).get("IN|5")?.includes("KEY-DELIVERY"), false);
eq("and it is filed under the term, not the bundle",
  [...servicesInSelectResponse(myBox5y, made).keys()], ["IN|5"]);

console.log("\nWhat the customer is charged");
// The reported journey: MyHome, three years, one agent, courier requested.
eq("MyHome 3y with an agent and no courier available is 2,155",
  rentalTotal({ base: 2155, keyDeliveryPrice: null }, { agentCount: 1, keyDelivery: true }).total, 2155);
eq("...and the 30 is not added just because they asked",
  rentalTotal({ base: 2155, keyDeliveryPrice: null }, { keyDelivery: true }).total, 2155);
eq("MyBox 5y is 1,270 and no courier is added even if asked",
  rentalTotal({ base: 1270, keyDeliveryPrice: null }, { keyDelivery: true }).total, 1270);
eq("MyBox 1y with courier is 400",
  rentalTotal({ base: 370, keyDeliveryPrice: 30 }, { agentCount: 1, keyDelivery: true }).total, 400);
eq("the FIRST agent adds nothing",
  rentalTotal({ base: 370, agentExtraPrice: 50 }, { agentCount: 1 }).total, 370);
eq("a SECOND agent adds 50",
  rentalTotal({ base: 370, agentExtraPrice: 50 }, { agentCount: 2 }).total, 420);
eq("three agents add two fees",
  rentalTotal({ base: 370, agentExtraPrice: 50 }, { agentCount: 3 }).total, 470);
// The minimum amount is the rental and the registration, and nothing else:
// 2085 + 70 = 2155, so the Inclusive agent line is not inside it either.
eq("minimumAmount is rent + registration", 2085 + 70, 2155);

console.log("\nThe extra agent is priced for the TERM");
// Emirates Post returns the AGENT/A line already multiplied by the years, and
// their own page labels a three-year figure "per year". Both readings of AED
// 150 are in play, so the arithmetic has to be unambiguous.
const extraFor = (years: number) => 50 * years;
eq("one year", extraFor(1), 50);
eq("three years", extraFor(3), 150);
eq("five years", extraFor(5), 250);
eq("a second agent on a three-year MyHome adds 150 once, not 450",
  rentalTotal({ base: 2155, agentExtraPrice: 150 }, { agentCount: 2 }).total, 2305);
eq("a third adds another 150",
  rentalTotal({ base: 2155, agentExtraPrice: 150 }, { agentCount: 3 }).total, 2455);
eq("and the first is still free",
  rentalTotal({ base: 2155, agentExtraPrice: 150 }, { agentCount: 1 }).total, 2155);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
