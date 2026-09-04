/**
 * The rental total and the per-period prices (2026-09-04).
 *
 * Two reported bugs, both about a number the customer was shown.
 *
 * A summary said AED 370 while the payment page charged 400 -- the 30 courier
 * fee the customer had just chosen was in the payment and missing from the
 * summary. The same sum was being worked out in three places and they disagreed.
 *
 * And every rental period showed AED 300, because bundle_Price was being read
 * for all of them. PoBoxBundleItem prices each term separately.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-rental-total-2026-09-04.ts
 */
import { rentalTotal, bundlePeriods, describePeriods, wantsKeyDelivery, agentCountFrom } from "@/lib/rentalTotal";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};
const eq = (l: string, got: number, want: number) => check(`${l} → ${got}`, got === want, `expected ${want}`);

/** A real MyBox hold: 300 rental + 70 registration + first agent, agents 50, courier 30. */
const HOLD = { base: 370, agentExtraPrice: 50, keyDeliveryPrice: 30 };

// 1. THE 370/400 BUG, exactly as reported.
{
  eq("no extras is the hold itself", rentalTotal(HOLD).total, 370);
  eq("with key delivery", rentalTotal(HOLD, { keyDelivery: true }).total, 400);
  const r = rentalTotal(HOLD, { keyDelivery: true });
  check("the courier is its own line", r.lines.some((l) => /courier/i.test(l.label) && l.amount === 30), r.lines);
  check("the base line is the whole base", r.lines[0]?.amount === 370, r.lines);
}

// 2. THE 450/400 BUG, the other direction: the FIRST agent is already paid for.
{
  eq("one agent adds nothing", rentalTotal(HOLD, { agentCount: 1 }).total, 370);
  eq("two agents add one fee", rentalTotal(HOLD, { agentCount: 2 }).total, 420);
  eq("three agents add two", rentalTotal(HOLD, { agentCount: 3 }).total, 470);
  check("...and the extra count is reported", rentalTotal(HOLD, { agentCount: 3 }).extraAgents === 2);
  // Zero or a nonsense count must not credit the customer for the first agent.
  eq("zero agents is still one", rentalTotal(HOLD, { agentCount: 0 }).total, 370);
  eq("a negative count is still one", rentalTotal(HOLD, { agentCount: -5 }).total, 370);
}

// 3. Both at once.
{
  eq("two agents and a courier", rentalTotal(HOLD, { agentCount: 2, keyDelivery: true }).total, 450);
  check("three lines", rentalTotal(HOLD, { agentCount: 2, keyDelivery: true }).lines.length === 3);
}

// 4. Missing prices are zero, not undefined arithmetic. A bundle that does not
//    offer courier must not turn the total into NaN.
{
  eq("no courier price, courier asked for", rentalTotal({ base: 370 }, { keyDelivery: true }).total, 370);
  eq("no agent price, extra agents", rentalTotal({ base: 370 }, { agentCount: 4 }).total, 370);
  eq("null prices", rentalTotal({ base: 370, agentExtraPrice: null, keyDeliveryPrice: null }, { agentCount: 2, keyDelivery: true }).total, 370);
  check("a NaN base does not propagate", Number.isFinite(rentalTotal({ base: NaN as number }).total));
}

// 5. Rounded to fils: a float total reaches the gateway as 400.00000000000006.
{
  const r = rentalTotal({ base: 370.1, agentExtraPrice: 0.2 }, { agentCount: 3 });
  check("two decimals at most", Number.isInteger(Math.round(r.total * 100)), r.total);
  eq("370.1 + 2×0.2", r.total, 370.5);
}

// 6. THE PERIOD PRICES. bundle_Price is TWELVE MONTHS, not "the price".
{
  const bundle = {
    bundle_Id: "MYBOX3", name_En: "MyBox Silver",
    bundle_Price: "300", bundle24Month_Price: "550", bundle36Month_Price: "780",
    bundle60Month_Price: "", bundle120Month_Price: null,
  };
  const p = bundlePeriods(bundle);
  check("three priced periods", p.length === 3, p);
  eq("12 months", p[0]!.price, 300);
  eq("24 months", p[1]!.price, 550);
  eq("36 months", p[2]!.price, 780);
  check("years are derived", p[1]!.years === 2, p[1]);
  // The bug: 2 years is NOT 2 × the 1-year price, so it must never be computed.
  check("24mo is not twice 12mo", p[1]!.price !== p[0]!.price * 2, p);
  check("empty string dropped", !p.some((x) => x.months === 60), p);
  check("null dropped", !p.some((x) => x.months === 120), p);
  check("the description names each period", describePeriods(p).includes("2 years (24 months) — AED 550.00"), describePeriods(p));
}

// 7. A bundle with one term has one price, and is not padded out.
{
  const p = bundlePeriods({ bundle_Price: "300" });
  check("one period only", p.length === 1 && p[0]!.months === 12, p);
  check("no periods at all is empty", bundlePeriods({}).length === 0);
  check("a zero price is not a free rental", bundlePeriods({ bundle_Price: "0" }).length === 0);
  check("junk is dropped", bundlePeriods({ bundle_Price: "n/a" }).length === 0);
  check("currency prefixes survive", bundlePeriods({ bundle_Price: "AED 300.00" })[0]?.price === 300);
}

// 8. Reading the customer's choices off the case.
{
  check("deliver", wantsKeyDelivery("deliver"));
  check("courier", wantsKeyDelivery("courier"));
  check("true", wantsKeyDelivery(true));
  check("Arabic yes", wantsKeyDelivery("نعم"));
  check("branch pickup is not delivery", !wantsKeyDelivery("branch_pickup"));
  check("undefined is not delivery", !wantsKeyDelivery(undefined));
  check("agent count from a number", agentCountFrom({ agent_count: 3 }) === 3);
  check("agent count from a string", agentCountFrom({ agent_count: "2" }) === 2);
  check("agent count from a list", agentCountFrom({ agents: [{}, {}] }) === 2);
  check("no agents recorded is one", agentCountFrom({}) === 1);
  check("nonsense is one", agentCountFrom({ agent_count: "lots" }) === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
