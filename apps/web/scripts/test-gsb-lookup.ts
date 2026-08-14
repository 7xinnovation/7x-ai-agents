/**
 * Emirates ID normalisation + the GSB ownership check.
 *
 * This is the step that decides whether a customer may rent a corporate PO Box
 * against a trade licence, so the cases that matter are the near-misses: the same
 * ID written differently must match, and a licence whose owner records carry no
 * readable Emirates ID must NOT come back as "not the owner" — that is unknown,
 * and unknown falls back to document review.
 *
 * Run from apps/web:  npx tsx scripts/test-gsb-lookup.ts
 */
import { cleanEntityName, normaliseEmiratesId, ownerMatch, type GsbOwner } from "../lib/gsbLookup";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};

const owner = (emiratesId?: string, nameEn = "Owner"): GsbOwner => ({ nameEn, emiratesId });

console.log("normaliseEmiratesId");
check("dashed form", normaliseEmiratesId("784-1980-1234567-1"), "784198012345671");
check("bare digits", normaliseEmiratesId("784198012345671"), "784198012345671");
check("spaces and dashes mixed", normaliseEmiratesId(" 784 1980-1234567 1 "), "784198012345671");
check("14 digits is not an Emirates ID", normaliseEmiratesId("78419801234567"), null);
check("16 digits is not an Emirates ID", normaliseEmiratesId("7841980123456712"), null);
check("empty string", normaliseEmiratesId(""), null);
check("non-string", normaliseEmiratesId(undefined), null);
check("letters stripped to too few digits", normaliseEmiratesId("EID-784"), null);

console.log("\nownerMatch");
const owners = [owner("784-1980-1234567-1", "Ahmed"), owner("784-1975-7654321-9", "Fatima")];
check("same ID, different formatting", ownerMatch(owners, "784198012345671"), "match");
check("same ID, dashed", ownerMatch(owners, "784-1980-1234567-1"), "match");
check("second owner matches", ownerMatch(owners, "784-1975-7654321-9"), "match");
check("a different person", ownerMatch(owners, "784-1990-1111111-1"), "no-match");

// The three-valued part. Collapsing these into a boolean is how an unchecked
// licence gets reported as verified, or a real owner gets turned away.
check("no owners at all", ownerMatch([], "784-1980-1234567-1"), "unknown");
check("owners carry no Emirates ID", ownerMatch([owner(undefined), owner("")], "784-1980-1234567-1"), "unknown");
check("owner IDs are malformed", ownerMatch([owner("N/A"), owner("784")], "784-1980-1234567-1"), "unknown");
check("customer's own ID is malformed", ownerMatch(owners, "not-an-eid"), "unknown");
check(
  "one unreadable owner still matches a readable one",
  ownerMatch([owner("N/A"), owner("784-1980-1234567-1")], "784198012345671"),
  "match"
);
check(
  "unreadable owners do not mask a genuine no-match",
  ownerMatch([owner("N/A"), owner("784-1975-7654321-9")], "784-1990-1111111-1"),
  "no-match"
);

console.log("\ncleanEntityName");
// Real value from the box-stg registry — the note is part of the name field.
check(
  "strips an internal maintenance note",
  cleanEntityName("Fujairah Culture & Media Authority (FCMA)TO-BE-REMOVE-OR-ASSIGN-TO-NEW-ED"),
  "Fujairah Culture & Media Authority (FCMA)"
);
check("leaves a clean name alone", cleanEntityName("Dubai Silicon Oasis"), "Dubai Silicon Oasis");
check("keeps a legitimate parenthetical", cleanEntityName("Abu Dhabi Media Free Zone (TwoFour54)"), "Abu Dhabi Media Free Zone (TwoFour54)");
check("strips DO NOT USE", cleanEntityName("Some Authority DO NOT USE"), "Some Authority");
check("a name that is only a note becomes undefined", cleanEntityName("TO-BE-REMOVED"), undefined);
check("non-string", cleanEntityName(null), undefined);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
