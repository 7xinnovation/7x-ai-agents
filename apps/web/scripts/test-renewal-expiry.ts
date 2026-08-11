/**
 * Regression: renewal pricing dates must land on the box's own anniversary.
 *
 * Production 2026-08-11 reported "the pricing system is returning an error".
 * Emirates Post accepts a renewal price only on the box's own anniversary
 * (same month+day as its current expiry), strictly in the future — our guidance
 * said "year-end", which worked only for boxes expiring 31 December.
 * Verified on staging: 7777 expires 27-12 → 2027-12-27 OK 600, 2027-12-31 FAIL.
 */
import { correctPricingExpiry } from "../lib/integrations";
const TODAY = new Date("2026-08-12T00:00:00Z");
let fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(` ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const exp = (iso: string) => ({ box: "2500", iso });
const price = (d: string) => ({ body: { boxNumber: "2500", expiryDate: d } });
const got = (d: string, iso: string) => (correctPricingExpiry(price(d), exp(iso), TODAY) as any)?.body?.expiryDate ?? "(unchanged)";

check("year-end guess corrected to the box's day", got("2027-12-31T00:00:00", "2025-12-30"), "2027-12-30T00:00:00");
check("lapsed box: 1 year lands on next future anniversary", got("2026-12-31T00:00:00", "2025-12-30"), "2026-12-30T00:00:00");
check("non-December box corrected", got("2027-12-31T00:00:00", "2025-12-27"), "2027-12-27T00:00:00");
check("already correct is left alone", got("2027-12-31T00:00:00", "2025-12-31"), "(unchanged)");
check("past target pushed into the future", got("2025-12-30T00:00:00", "2025-12-30"), "2026-12-30T00:00:00");
check("mid-year box keeps its own month/day", got("2028-12-31T00:00:00", "2026-03-09"), "2028-03-09T00:00:00");
check("no known expiry → no change", correctPricingExpiry(price("2027-12-31T00:00:00"), null, TODAY), null);
console.log(fail ? `\n${fail} FAILED` : "\nAll renewal-expiry checks passed.");
process.exit(fail ? 1 : 0);
