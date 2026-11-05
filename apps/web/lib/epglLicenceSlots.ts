/**
 * The catalogue slots that ARE the applicant's trade licence.
 *
 * EPGL's catalogue names the trade licence twice — "Trade Licence / Initial
 * Name Approval" for CEP30, "Trade Licence" for the other four products — and
 * our own `trade_license` slot reads the company off the same file. Declared
 * `satisfiedBy` so the applicant is asked for it once. Applied to the staging
 * definition by scripts/epgl-licence-satisfied-by-2026-11-05.
 *
 * A module of its own so it can be imported without side effects: it used to
 * live in that script, and a test importing it ran the script.
 */
export const LICENCE_SATISFIED_BY: Record<string, string[]> = {
  trade_licence_initial_name_approval: ["trade_license"],
  trade_licence: ["trade_license"],
};
