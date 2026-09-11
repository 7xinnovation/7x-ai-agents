/**
 * Identity numbers, shown to the person they belong to without being displayed
 * in full.
 *
 * EPGL, 11 September: "passport and Emirates ID numbers should be masked and not
 * displayed in full." They were printed complete in the application panel —
 * 784-1990-4193131-4 — on a screen that stays open beside a shared desk for the
 * length of an application.
 *
 * The tension worth naming: the panel exists so the applicant can CHECK what was
 * read off their documents, and a value masked to nothing cannot be checked. So
 * the last four characters stay. That is enough to tell your own card from
 * somebody else's and from a misread digit, and not enough to be an identity
 * document. Separators are kept so the shape still reads as an Emirates ID.
 *
 * Masking is presentation only. The value in the case is untouched, goes to
 * Salesforce in full, and the correction pencil edits the real one — a customer
 * who retyped what the panel showed them would otherwise save the mask.
 */

/** Field keys whose values are identity numbers. */
const IDENTITY_KEY = /(emirates_?id|passport)/i;

export function isIdentityKey(key: string): boolean {
  return IDENTITY_KEY.test(key);
}

/**
 * Mask all but the last four alphanumerics, keeping every separator in place.
 *
 * A value with four or fewer characters is left alone: masking it would say
 * nothing while still being unreadable, and anything that short is not an
 * identity number in the first place.
 */
export function maskIdentity(value: string): string {
  const chars = [...value];
  const positions = chars.map((c, i) => (/[0-9a-z]/i.test(c) ? i : -1)).filter((i) => i >= 0);
  if (positions.length <= 4) return value;
  const keepFrom = positions[positions.length - 4]!;
  return chars.map((c, i) => (i < keepFrom && /[0-9a-z]/i.test(c) ? "•" : c)).join("");
}

/** The panel's rendering of one captured value. */
export function maskForDisplay(key: string, shown: string): string {
  return isIdentityKey(key) ? maskIdentity(shown) : shown;
}
