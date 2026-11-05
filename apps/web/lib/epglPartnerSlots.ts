/**
 * EPGL's names for partners 2-8's passport and Emirates ID.
 *
 * Their own catalogue names, the same as partner 1's: since 5 November an item
 * carrying a `Holder` gets a slot of its own ("Copy of Passport - Sara Al
 * Hashimi") instead of stacking behind partner 1's (lib/epglComposite,
 * holderOf). Applied to the staging definition by
 * scripts/epgl-partner-holder-2026-11-05.
 *
 * A module of its own so a test can import it without running the script.
 */
export const PARTNER_SALESFORCE_TYPES: Record<string, string> = Object.fromEntries(
  [2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
    [`partner_${n}_passport`, "Copy of Passport"],
    [`partner_${n}_emirates_id`, "Copy of Emirates ID"],
  ])
);
