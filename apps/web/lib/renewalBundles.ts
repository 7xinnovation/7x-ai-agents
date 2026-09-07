/**
 * Which bundles a renewing customer may choose.
 *
 * Emirates Post's rule: on a renewal, show the bundle they are ON and anything
 * ABOVE it — never a lower tier. Downgrading is not something the renewal flow
 * supports, so offering a cheaper bundle sets up a choice that cannot complete,
 * and the customer only finds out after picking it.
 *
 * `isUpgrade` on each entry is their own flag and is trusted first. Where it is
 * absent the tier is decided by PRICE against the current bundle, which is the
 * same ordering their own portal shows. Equal price counts as same-tier and is
 * kept: a like-for-like alternative is not a downgrade.
 */

export interface RenewalBundle {
  bundleId?: string;
  bundleName?: string;
  yearlyPrice?: string | number;
  upgradePrice?: number;
  isUpgrade?: boolean;
  [k: string]: unknown;
}

const price = (b: RenewalBundle | undefined): number | null => {
  if (!b) return null;
  const raw = b.yearlyPrice;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const sameBundle = (a: RenewalBundle, b: RenewalBundle | undefined) =>
  Boolean(b?.bundleId && a.bundleId && String(a.bundleId).trim() === String(b.bundleId).trim());

/**
 * Keep the current bundle and every upgrade; drop the tiers below.
 *
 * Returns what to show and how many were dropped, so the caller can say the
 * list was filtered rather than silently showing fewer options than the backend
 * returned.
 */
export function renewalChoices(
  possible: RenewalBundle[],
  current: RenewalBundle | undefined
): { bundles: RenewalBundle[]; dropped: number } {
  if (!Array.isArray(possible) || !possible.length) return { bundles: [], dropped: 0 };
  const currentPrice = price(current);

  const kept = possible.filter((b) => {
    // Their own bundle is always offered — renewing on the same tier is the
    // ordinary case and must never be filtered out by a price comparison.
    if (sameBundle(b, current)) return true;
    // Their flag wins where it is set.
    if (b.isUpgrade === true) return true;
    if (b.isUpgrade === false) return false;
    // No flag: decide on price. Unknown prices are KEPT — "we cannot tell" is
    // not "it is lower", and hiding a real option is worse than showing one.
    const p = price(b);
    if (p === null || currentPrice === null) return true;
    return p >= currentPrice;
  });

  return { bundles: kept, dropped: possible.length - kept.length };
}

/** The bundles above the customer's own, in the order Emirates Post listed them. */
export function upgradesAmong(kept: RenewalBundle[], current: RenewalBundle | undefined): RenewalBundle[] {
  return kept.filter((b) => !sameBundle(b, current));
}

/** "MyHome Instant (AED 995 a year)" — a name a customer can be offered. */
export function describeBundle(b: RenewalBundle): string {
  const name = String(b.bundleName ?? b.bundleId ?? "").trim();
  const p = price(b);
  return p !== null ? `${name} (AED ${p} a year)` : name;
}
