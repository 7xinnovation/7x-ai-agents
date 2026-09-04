/**
 * The reservation must be made for the term the customer chose.
 *
 * 4 Sep: they picked "2 Years — expires 03-09-2028, AED 670" and the reservation
 * went out with the ONE year date. Everything downstream inherited it.
 *
 * Run from apps/web:  npx tsx scripts/test-rental-duration-2026-09-04.ts
 */
import { durationYears, dateForYears, yearsUntil } from "../lib/integrations";

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};

console.log("\nReading the recorded choice");
eq("the value the case actually holds", durationYears("2_YEAR"), 2);
eq("1_YEAR", durationYears("1_YEAR"), 1);
eq("10_YEAR", durationYears("10_YEAR"), 10);
eq("prose", durationYears("2 years"), 2);
eq("a bare number", durationYears("3"), 3);
eq("months, when whole years", durationYears("24_MONTH"), 2);
eq("months that are not whole years are refused", durationYears("18 months"), null);
eq("nothing recorded", durationYears(""), null);
eq("nonsense", durationYears("soon"), null);
eq("absurd", durationYears("99 years"), null);

console.log("\nPicking the offered date");
// Exactly what Rental/ExpiryDates returns for every bundle, 4 Sep 2026.
const offered = [
  "2027-09-03T00:00:00+00:00",
  "2028-09-03T00:00:00+00:00",
  "2029-09-03T00:00:00+00:00",
  "2031-09-03T00:00:00+00:00",
  "2036-09-03T00:00:00+00:00",
];
eq("one year", dateForYears(offered, 1), offered[0]);
eq("TWO YEARS — the one that was dropped", dateForYears(offered, 2), offered[1]);
eq("three", dateForYears(offered, 3), offered[2]);
eq("five", dateForYears(offered, 5), offered[3]);
eq("ten", dateForYears(offered, 10), offered[4]);
eq("a term not offered returns nothing", dateForYears(offered, 4), null);
eq("an empty list returns nothing", dateForYears([], 2), null);
eq("unparseable dates are skipped", dateForYears(["not a date", offered[1]!], 2), offered[1]);
// Copied verbatim: recomputing the string returns "Invalid date value".
eq("the string comes back exactly as offered", dateForYears(offered, 2)?.endsWith("+00:00"), true);

console.log("\nHow long is each offered date?");
const now = new Date("2026-09-04T12:00:00Z");
eq("one year out", yearsUntil("2027-09-03T00:00:00+00:00", now), 1);
eq("two", yearsUntil("2028-09-03T00:00:00+00:00", now), 2);
eq("three", yearsUntil("2029-09-03T00:00:00+00:00", now), 3);
eq("five", yearsUntil("2031-09-03T00:00:00+00:00", now), 5);
eq("ten", yearsUntil("2036-09-03T00:00:00+00:00", now), 10);
eq("a date in the past is not a term", yearsUntil("2020-01-01T00:00:00+00:00", now), null);
eq("today is not a term", yearsUntil("2026-09-04T00:00:00+00:00", now), null);
eq("nonsense", yearsUntil("not a date", now), null);
// MyBox publishes only an annual rate, so the term prices are that rate times
// the years plus one registration fee — 600 + 70 for two years, which is what
// the reservation actually came back at.
const annual = 300, fee = 70;
eq("MyBox two years is what the reservation charged", annual * (yearsUntil("2028-09-03T00:00:00+00:00", now) ?? 0) + fee, 670);
eq("MyBox one year", annual * (yearsUntil("2027-09-03T00:00:00+00:00", now) ?? 0) + fee, 370);
eq("MyBox ten years", annual * (yearsUntil("2036-09-03T00:00:00+00:00", now) ?? 0) + fee, 3070);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
