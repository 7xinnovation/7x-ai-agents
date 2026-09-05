/**
 * The save payload must match the shape Emirates Post published.
 *
 * `paymentProperties.savedCard` defines exactly five fields. The saved-cards
 * lookup returns the whole card record, and substituting it wholesale started
 * sending isDefault and isExpired as well — fields their contract does not
 * describe. Every payment that has settled carried five; the ones after 16:10 on
 * 4 Sep carried seven.
 *
 * Run from apps/web:  npx tsx scripts/test-save-payload-shape-2026-09-04.ts
 */
export {}; // a module, so its locals do not collide with the other scripts

const SPEC_FIELDS = ["expiry", "scheme", "cardToken", "maskedPan", "cardholderName"] as const;

/** The same trim the save applies, kept here so the shape is testable on its own. */
function toSpecCard(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;
  return Object.fromEntries(
    SPEC_FIELDS.map((k) => [k, raw[k]]).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};

// Exactly what nxn_saved_cards returns for the staging test customer.
const fromLookup = {
  expiry: "2030-12",
  scheme: "VISA",
  cardToken: "dG9rZW5pemVkUGFuLy92MS8vU0hPV19OT05FLy8xMTExMTExNDExMTExMTEx",
  isDefault: true,
  isExpired: false,
  maskedPan: "*****1111",
  cardholderName: "Test Card",
};

eq("the record is trimmed to the five published fields",
  Object.keys(toSpecCard(fromLookup)!).sort(),
  [...SPEC_FIELDS].sort());
eq("the token survives verbatim", toSpecCard(fromLookup)!.cardToken, fromLookup.cardToken);
eq("isDefault and isExpired are gone",
  ["isDefault", "isExpired"].filter((k) => k in toSpecCard(fromLookup)!),
  []);
eq("no card, no block", toSpecCard(null), null);
eq("empty values are dropped rather than sent blank",
  toSpecCard({ ...fromLookup, cardholderName: "" }),
  { expiry: "2030-12", scheme: "VISA", cardToken: fromLookup.cardToken, maskedPan: "*****1111" });
// The shape that settled on 3 Sep and twice on 4 Sep, byte for byte.
eq("matches the payload that has actually been paid",
  toSpecCard(fromLookup),
  { expiry: "2030-12", scheme: "VISA", cardToken: fromLookup.cardToken, maskedPan: "*****1111", cardholderName: "Test Card" });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
