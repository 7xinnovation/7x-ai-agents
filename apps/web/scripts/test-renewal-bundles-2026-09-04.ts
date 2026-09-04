/**
 * Renewal shows the current tier and upwards only (2026-09-04).
 *
 * Emirates Post's rule: a renewal keeps the customer's bundle or upgrades it.
 * Downgrading is not supported here, so a cheaper bundle on the list is a choice
 * that cannot complete — and the customer only finds that out after picking it.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-renewal-bundles-2026-09-04.ts
 */
import { renewalChoices, type RenewalBundle } from "@/lib/renewalBundles";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};
const ids = (b: RenewalBundle[]) => b.map((x) => x.bundleId).join(",");

const BRONZE: RenewalBundle = { bundleId: "MYBOX1", bundleName: "Bronze", yearlyPrice: "200" };
const SILVER: RenewalBundle = { bundleId: "MYBOX3", bundleName: "Silver", yearlyPrice: "300" };
const GOLD: RenewalBundle = { bundleId: "MYBOX5", bundleName: "Gold", yearlyPrice: "500" };

// 1. On Silver: Bronze disappears, Silver and Gold stay.
{
  const { bundles, dropped } = renewalChoices([BRONZE, SILVER, GOLD], SILVER);
  check("bronze is dropped", !bundles.some((b) => b.bundleId === "MYBOX1"), ids(bundles));
  check("their own bundle is kept", bundles.some((b) => b.bundleId === "MYBOX3"), ids(bundles));
  check("the upgrade is kept", bundles.some((b) => b.bundleId === "MYBOX5"), ids(bundles));
  check("one dropped", dropped === 1, dropped);
}

// 2. Their own isUpgrade flag wins where it is set.
{
  const flagged = [
    { ...BRONZE, isUpgrade: false },
    { ...SILVER, isUpgrade: false },
    { ...GOLD, isUpgrade: true },
  ];
  const { bundles } = renewalChoices(flagged, SILVER);
  check("isUpgrade true is kept", bundles.some((b) => b.bundleId === "MYBOX5"), ids(bundles));
  check("isUpgrade false is dropped", !bundles.some((b) => b.bundleId === "MYBOX1"), ids(bundles));
  // Even flagged false, their CURRENT bundle must survive -- renewing on the
  // same tier is the ordinary case and is not an upgrade.
  check("the current bundle survives its own false flag", bundles.some((b) => b.bundleId === "MYBOX3"), ids(bundles));
}

// 3. A same-priced alternative is not a downgrade.
{
  const twin: RenewalBundle = { bundleId: "MYBOX3B", bundleName: "Silver Plus", yearlyPrice: "300" };
  const { bundles } = renewalChoices([BRONZE, SILVER, twin, GOLD], SILVER);
  check("equal price is kept", bundles.some((b) => b.bundleId === "MYBOX3B"), ids(bundles));
}

// 4. Unknown prices are KEPT. "We cannot tell" is not "it is lower", and hiding
//    a real option is worse than showing one.
{
  const vague: RenewalBundle = { bundleId: "MYBOXX", bundleName: "Unpriced" };
  const { bundles } = renewalChoices([BRONZE, SILVER, vague], SILVER);
  check("an unpriced bundle is kept", bundles.some((b) => b.bundleId === "MYBOXX"), ids(bundles));
  const noCurrentPrice = renewalChoices([BRONZE, SILVER, GOLD], { bundleId: "MYBOX3" });
  check("no current price keeps everything", noCurrentPrice.dropped === 0, noCurrentPrice.bundles.length);
}

// 5. Edges that must not throw or empty the list.
{
  check("no bundles", renewalChoices([], SILVER).bundles.length === 0);
  check("no current bundle keeps all", renewalChoices([BRONZE, SILVER, GOLD], undefined).dropped === 0);
  check("a non-array is empty", renewalChoices(undefined as unknown as RenewalBundle[], SILVER).bundles.length === 0);
  // On the cheapest tier nothing is below them, so nothing is dropped.
  check("on the lowest tier nothing is dropped", renewalChoices([BRONZE, SILVER, GOLD], BRONZE).dropped === 0);
  // On the top tier only their own remains.
  const top = renewalChoices([BRONZE, SILVER, GOLD], GOLD);
  check("on the top tier only theirs remains", ids(top.bundles) === "MYBOX5", ids(top.bundles));
}

// 6. Prices as strings with currency, which is how they arrive.
{
  const { bundles } = renewalChoices(
    [{ bundleId: "A", yearlyPrice: "AED 200.00" }, { bundleId: "B", yearlyPrice: "500" }],
    { bundleId: "C", yearlyPrice: "AED 300.00" }
  );
  check("currency prefixes parse", ids(bundles) === "B", ids(bundles));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
