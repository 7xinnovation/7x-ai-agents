/**
 * Registration fee and multi-year savings (2026-09-04).
 *
 * Emirates Post asked for the registration fee to be shown WITH ITS AMOUNT
 * before payment, and for a multi-year discount to be visible. Neither figure is
 * published anywhere, so both are derived — and a derived money figure stated
 * wrongly is worse than one described in words. AED 25 taught that once.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-fees-savings-2026-09-04.ts
 */
import { registrationFee, periodSavings, describeSavings, bundlePeriods } from "@/lib/rentalTotal";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

// 1. The real case: a 300 bundle held at 370 means 70 registration.
{
  check("370 hold on a 300 term is a 70 fee", registrationFee(370, 300) === 70, registrationFee(370, 300));
  check("a 2-year term is measured against ITS price", registrationFee(620, 550) === 70, registrationFee(620, 550));
  check("fils survive", registrationFee(370.5, 300.25) === 70.25, registrationFee(370.5, 300.25));
}

// 2. Refuses to invent one. Every one of these would put a wrong number in
//    front of a customer, so each returns null and the wording falls back.
{
  check("equal figures mean no separable fee", registrationFee(300, 300) === null);
  check("a hold BELOW the term price is not a fee", registrationFee(280, 300) === null);
  check("no hold", registrationFee(null, 300) === null);
  check("no term price", registrationFee(370, null) === null);
  check("a zero term price", registrationFee(370, 0) === null);
  check("NaN", registrationFee(NaN, 300) === null);
  check("undefined both", registrationFee(undefined, undefined) === null);
}

// 3. Multi-year savings, against buying a year at a time.
{
  const periods = bundlePeriods({ bundle_Price: "300", bundle24Month_Price: "550", bundle36Month_Price: "780" });
  const s = periodSavings(periods);
  check("two savings", s.length === 2, s);
  check("2 years saves 50", s[0]?.saving === 50, s[0]);
  check("...against 600", s[0]?.yearlyEquivalent === 600, s[0]);
  check("...which is 8%", s[0]?.percent === 8, s[0]);
  check("3 years saves 120", s[1]?.saving === 120, s[1]);
  check("...which is 13%", s[1]?.percent === 13, s[1]);
  check("the description is the customer's own arithmetic",
    describeSavings(s).includes("2 years at AED 550.00 saves AED 50.00 (8%)"), describeSavings(s));
}

// 4. No saving is NOT dressed up as one. A longer term that costs the same or
//    more must not be sold as a discount.
{
  const flat = periodSavings(bundlePeriods({ bundle_Price: "300", bundle24Month_Price: "600" }));
  check("exactly twice yearly is no saving", flat.length === 0, flat);
  const worse = periodSavings(bundlePeriods({ bundle_Price: "300", bundle24Month_Price: "650" }));
  check("dearer than yearly is no saving", worse.length === 0, worse);
}

// 5. Nothing to compare against.
{
  check("no 12-month price, no savings", periodSavings(bundlePeriods({ bundle24Month_Price: "550" })).length === 0);
  check("one term only", periodSavings(bundlePeriods({ bundle_Price: "300" })).length === 0);
  check("no periods", periodSavings([]).length === 0);
  check("an empty description is empty", describeSavings([]) === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
