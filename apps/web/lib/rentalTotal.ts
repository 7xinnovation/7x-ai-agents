/**
 * What a PO Box rental costs, computed once.
 *
 * This exists because the same figure was being worked out in three places and
 * they disagreed. Emirates Post's `minimumAmount` on the hold already contains
 * the annual rent, the one-time registration fee AND the first authorised agent
 * -- that agent's price line comes back marked Inclusive. Only agents beyond the
 * first are charged, plus the key courier if the customer chose it.
 *
 * Two bugs came out of that, both seen by the customer:
 *
 *   The model read priceDetails as a list of things to add up, added the first
 *   agent's 50 on top of a total that already contained it, and showed AED 450
 *   for a 400 rental. The backend then refused with "121 MISMATCH_IN_AMOUNT:
 *   TotalAmountShouldBe:400".
 *
 *   And the reverse: the summary quoted the bare hold, 370, while the payment
 *   page correctly charged 400 -- the 30 courier fee the customer had just asked
 *   for was in the save and missing from the summary. Being undercharged in the
 *   summary is not a kindness; it is the number they agreed to not matching the
 *   number they paid.
 *
 * So the arithmetic lives here, every caller uses it, and the summary, the
 * payment and the save cannot drift apart because there is only one of them.
 */

export interface RentalCharges {
  /** minimumAmount from the hold: rent + registration + the first agent. */
  base: number;
  /** What each agent AFTER the first costs. */
  agentExtraPrice?: number | null;
  /** What key courier delivery costs, when the bundle offers it. */
  keyDeliveryPrice?: number | null;
}

export interface RentalChoices {
  /** Total authorised agents, INCLUDING the first. */
  agentCount?: number;
  /** Whether the customer chose courier delivery of the key. */
  keyDelivery?: boolean;
}

export interface RentalTotal {
  total: number;
  base: number;
  extraAgents: number;
  agentsCost: number;
  courierCost: number;
  lines: { label: string; amount: number }[];
}

/** Round to fils. A float total reaches the gateway as 400.00000000000006. */
const fils = (v: number) => Math.round(v * 100) / 100;

/**
 * The charged total, and the breakdown behind it.
 *
 * `agentCount` is the TOTAL number of agents, first included -- that is how the
 * customer counts them and how the save payload states it. Anything below 1 is
 * treated as 1, because the first agent is not optional and is already paid for.
 */
export function rentalTotal(charges: RentalCharges, choices: RentalChoices = {}): RentalTotal {
  const base = Number.isFinite(charges.base) ? charges.base : 0;
  const extraAgents = Math.max(0, (choices.agentCount ?? 1) - 1);
  const agentsCost = fils(extraAgents * (charges.agentExtraPrice ?? 0));
  const courierCost = choices.keyDelivery ? fils(charges.keyDeliveryPrice ?? 0) : 0;

  const lines = [{ label: "Box rental, registration and first agent", amount: fils(base) }];
  if (agentsCost > 0) {
    lines.push({ label: `${extraAgents} additional agent${extraAgents === 1 ? "" : "s"}`, amount: agentsCost });
  }
  if (courierCost > 0) lines.push({ label: "Key delivery by courier", amount: courierCost });

  return { total: fils(base + agentsCost + courierCost), base: fils(base), extraAgents, agentsCost, courierCost, lines };
}

/** Truthy the several ways a yes reaches us from a toggle, a card or Arabic. */
export function wantsKeyDelivery(v: unknown): boolean {
  if (v === true) return true;
  return /^(deliver|courier|delivery|yes|true|1|نعم)$/i.test(String(v ?? "").trim());
}

/** How many agents the customer asked for, first included. */
export function agentCountFrom(data: Record<string, unknown>): number {
  for (const key of ["agent_count", "agents", "number_of_agents", "authorised_agents"]) {
    const raw = data[key];
    if (Array.isArray(raw)) return Math.max(1, raw.length);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return 1;
}

/**
 * The price of each rental period a bundle offers.
 *
 * `PoBoxBundleItem` carries a separate price per term -- bundle_Price is TWELVE
 * MONTHS, and bundle24Month_Price, bundle36Month_Price, bundle60Month_Price and
 * bundle120Month_Price are the longer ones. The model was reading bundle_Price
 * alone and quoting AED 300 for every period, so a customer choosing three years
 * was shown the one-year price and would have discovered the real figure at
 * checkout.
 *
 * Only periods the bundle actually prices are returned. A missing or unparseable
 * field is DROPPED rather than defaulted or multiplied out: two years is not
 * reliably twice one year, and inventing that is how a wrong price becomes a
 * confident one.
 */
export interface BundlePeriod {
  months: number;
  years: number;
  price: number;
  /** The field it came from, so a mismatch can be traced back. */
  field: string;
}

const PERIOD_FIELDS: { field: string; months: number }[] = [
  { field: "bundle_Price", months: 12 },
  { field: "bundle24Month_Price", months: 24 },
  { field: "bundle36Month_Price", months: 36 },
  { field: "bundle60Month_Price", months: 60 },
  { field: "bundle120Month_Price", months: 120 },
];

export function bundlePeriods(bundle: Record<string, unknown>): BundlePeriod[] {
  const out: BundlePeriod[] = [];
  for (const { field, months } of PERIOD_FIELDS) {
    const raw = bundle[field];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    // Prices arrive as STRINGS ("300", "300.00"); a bare Number() on "" is 0,
    // which would put a free rental on the card.
    const price = Number(String(raw).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({ months, years: months / 12, price: fils(price), field });
  }
  return out;
}

/** "1 year — AED 300; 2 years — AED 550" for the model to put on the card. */
export function describePeriods(periods: BundlePeriod[]): string {
  return periods
    .map((p) => `${p.years} year${p.years === 1 ? "" : "s"} (${p.months} months) — AED ${p.price.toFixed(2)}`)
    .join("; ");
}

/**
 * The one-time registration fee, worked out rather than guessed.
 *
 * Emirates Post publishes no endpoint for it and it appears in no response of
 * its own, so it has always been described to the customer as "a fee applies,
 * shown before you pay" — which is true and unhelpful, and they have now asked
 * for the amount before payment.
 *
 * It is derivable: the hold's `minimumAmount` is the rental for the chosen term
 * PLUS the registration PLUS the first agent, and the first agent is Inclusive
 * (zero). So the registration is the difference between the hold and the
 * published price of the term the customer picked.
 *
 * Returns null rather than a number whenever the arithmetic cannot be trusted —
 * an unknown term price, a difference of zero, or a negative. A registration fee
 * stated wrongly is worse than one described in words, and AED 25 taught us that
 * once already.
 */
export function registrationFee(holdAmount: number | null | undefined, termPrice: number | null | undefined): number | null {
  if (typeof holdAmount !== "number" || !Number.isFinite(holdAmount)) return null;
  if (typeof termPrice !== "number" || !Number.isFinite(termPrice) || termPrice <= 0) return null;
  const fee = fils(holdAmount - termPrice);
  // Zero means the hold equals the rental, so nothing was added and there is
  // nothing to announce. Negative means the two figures are not what we think
  // they are, and inventing a fee from that is exactly the mistake to avoid.
  return fee > 0 ? fee : null;
}

/**
 * What a multi-year term saves against paying yearly.
 *
 * The comparison the customer actually makes: this term versus the same number
 * of years bought one at a time. Emirates Post asked for the saving to be shown
 * so a longer term reads as a choice rather than a bigger number.
 *
 * Only returned when it is a genuine saving. A term that costs the same or more
 * than yearly renewal has no discount, and dressing that up would be a lie in
 * the customer's own arithmetic.
 */
export interface PeriodSaving {
  months: number;
  years: number;
  price: number;
  /** What the same span costs bought a year at a time. */
  yearlyEquivalent: number;
  saving: number;
  percent: number;
}

export function periodSavings(periods: BundlePeriod[]): PeriodSaving[] {
  const yearly = periods.find((p) => p.months === 12);
  if (!yearly) return [];
  const out: PeriodSaving[] = [];
  for (const p of periods) {
    if (p.months === 12) continue;
    const yearlyEquivalent = fils(yearly.price * p.years);
    const saving = fils(yearlyEquivalent - p.price);
    if (saving <= 0) continue;
    out.push({
      months: p.months,
      years: p.years,
      price: p.price,
      yearlyEquivalent,
      saving,
      percent: Math.round((saving / yearlyEquivalent) * 100),
    });
  }
  return out;
}

/** "2 years AED 550 — saves AED 50 (8%) against 2 × AED 300" */
export function describeSavings(savings: PeriodSaving[]): string {
  return savings
    .map(
      (s) =>
        `${s.years} years at AED ${s.price.toFixed(2)} saves AED ${s.saving.toFixed(2)} (${s.percent}%) against paying yearly (${s.years} × AED ${(s.yearlyEquivalent / s.years).toFixed(2)} = AED ${s.yearlyEquivalent.toFixed(2)})`
    )
    .join("; ");
}
