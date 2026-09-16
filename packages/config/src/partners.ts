/**
 * A PARTNER THAT IS A COMPANY HAS NO PASSPORT.
 *
 * JNT EXPRESS COURIER SERVICES L.L.C, 16 September: partner 1 on the trade
 * licence is GLOBAL JET EXPRESS AE FZCO — a corporate shareholder, which is
 * ordinary on a UAE licence and exactly what the document says. The extraction
 * was right. What was wrong is what came next: the journey asked that company
 * for a passport copy and an Emirates ID, and there is no answer to that
 * question, so the renewal could not be completed.
 *
 * The legal-form markers are the evidence — FZCO, L.L.C, ش.ذ.م.م — not a guess
 * from the shape of the words: a person can be called anything, and being wrong
 * in this direction asks a human being for a trade licence they do not have.
 * Only a name carrying one of these is treated as a company.
 */
const CORPORATE_MARKER =
  /(^|[\s(.,-])(fzco|fze|fzc|llc|l\.l\.c|w\.l\.l|wll|pjsc|psc|ltd|limited|inc|incorporated|plc|est|establishment|holdings?|group|enterprises?)([\s).,-]|$)/i;
/** The Arabic forms, which carry no Latin abbreviation to match on. */
const CORPORATE_MARKER_AR = /(ذ\.?\s?م\.?\s?م|ش\.?\s?ذ\.?\s?م\.?\s?م|ش\.?\s?م\.?\s?ع|مؤسسة|شركة)/;

/** Is this partner a company rather than a person? */
export function corporatePartner(name: unknown): boolean {
  const n = String(name ?? "").trim();
  if (n.length < 3) return false;
  return CORPORATE_MARKER.test(n) || CORPORATE_MARKER_AR.test(n);
}

/**
 * Mark the corporate partners on a case, so the per-partner identity documents
 * stop applying to them.
 *
 * Written into the case rather than decided at render time: the document
 * conditions are configuration, the panel reads the same data, and a fact the
 * assistant can see is a fact it stops asking about. Never overwrites a type
 * already recorded — if a human said otherwise, they were looking at the licence.
 */
export function withPartnerTypes<T extends { data: Record<string, unknown> }>(state: T): T {
  let changed = false;
  const data = { ...state.data };
  for (const [key, value] of Object.entries(state.data)) {
    const m = /^partner_(\d+)_name$/.exec(key);
    if (!m) continue;
    const typeKey = `partner_${m[1]}_type`;
    if (data[typeKey]) continue;
    const type = corporatePartner(value) ? "company" : "person";
    data[typeKey] = type;
    changed = true;
  }
  return changed ? { ...state, data } : state;
}
