/**
 * "Got it." — and nothing else (2 November 2026).
 *
 * Emirates Post asked for the chosen term and its fee in the confirmation. The
 * transcript they sent shows the gap: 1 Year is tapped, the reply moves
 * straight to the authorised-agent question, and the next number the customer
 * sees is the payment total.
 *
 * The price is already on the card they tapped — stamped from the ladder
 * Emirates Post priced, never multiplied up — so the rule asks for that figure
 * to be REPEATED. These checks are mostly about the ways it could be invented
 * instead, because a wrong number here is worse than the silence it replaces.
 *
 * Run from apps/web:  npx tsx scripts/test-nxn-duration-fee-2026-11-02.ts
 */
import { JOURNEYS, MARKER, RULE } from "./nxn-duration-fee-2026-11-02";
import { durationChosen } from "@/lib/narrationGuard";
import { keepOnlyTerm, yearsInTitle, type Term } from "@/lib/durationCards";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : (extra ?? ""));
  ok ? pass++ : fail++;
};

// ---- the rule says the thing that was asked for ----------------------------
check("the rule is dated and attributed", RULE.startsWith(MARKER));
check("it asks for BOTH the term and the fee", /names BOTH the term and what it costs/.test(RULE));
check("...and shows the shape", RULE.includes("Got it — 1 year, AED 370.00."));
check("...and quotes what was reported", /"Got it\." on its own/.test(RULE));
check("...in Arabic too", /تم — سنة واحدة، 370\.00 درهم/.test(RULE));

// ---- and the ways it must NOT be produced ----------------------------------
/**
 * The figure on a five-year card is not five annual rates: MyHome Instant's
 * five years is 4,000 against 4,975 of arithmetic. lib/durationCards exists
 * because that mistake was shipped once already.
 */
check("multiplying the annual rate is ruled out", /Do not multiply an annual rate by the number of years/.test(RULE));
check("adding the registration fee yourself is ruled out", /do not add the registration fee yourself/.test(RULE));
check("carrying a figure from another bundle is ruled out", /do not carry a figure across from a different bundle/.test(RULE));
check("an unpriced term stays unpriced", /confirmed when the box is reserved/.test(RULE));
check("...and that is said as a virtue, not an apology", /an honest blank is right where an invented figure is not/.test(RULE));
check("it stays one line, not a breakdown", /SAY IT ONCE/.test(RULE));
check("...leaving the breakdown where it already lives", /belong in the summary card/.test(RULE));

// ---- it goes only where something is rented --------------------------------
for (const k of ["personal_po_box_rental", "corporate_po_box_rental", "personal_po_box_renewal", "corporate_po_box_renewal"])
  check(`${k} gets the rule`, JOURNEYS.test(k));
/** Managing a box you already hold chooses no term and pays nothing. */
check("manage_po_box does not", !JOURNEYS.test("manage_po_box"));
check("nor does an EPGL licence journey", !JOURNEYS.test("new_license"));

// ---- the moment the rule fires is one the code already recognises ----------
/**
 * The rule is written for exactly what `durationChosen` detects — a card tap or
 * a bare "1 year" — so it fires on the turn the price is still on screen.
 */
check("a card tap is a choice", durationChosen("1 Year") === 1);
check("...typed, too", durationChosen("2 years") === 2);
check("...and in Arabic", durationChosen("سنتين") === 2);
check("a sentence is not a tap", durationChosen("what would 2 years cost me?") === null);

// ---- and the card it must quote is the one left on screen ------------------
{
  // The ladder the cards above were stamped from — unpriced at seven years.
  const terms: Term[] = [
    { years: 1, rent: 300, fee: 70, total: 370 },
    { years: 5, rent: 1200, fee: 70, total: 1270 },
    { years: 7, rent: null, fee: null, total: null },
  ];
  const menu = [
    "```cards",
    "- title: 1 Year",
    "  price: AED 370.00",
    "- title: 5 Years",
    "  price: AED 1,270.00",
    "- title: 7 Years",
    "  price: Confirmed when the box is reserved",
    "```",
  ].join("\n");
  const one = keepOnlyTerm(menu, 1);
  check("the menu collapses to the term chosen", one.includes("1 Year") && !one.includes("5 Years"), one);
  check("...carrying the figure the rule tells it to quote", one.includes("AED 370.00"), one);
  const seven = keepOnlyTerm(menu, 7);
  check("an unpriced term leaves nothing to quote", !/AED/.test(seven), seven);
  check("yearsInTitle reads the card the customer tapped", yearsInTitle("5 Years") === 5);
  check("...and the ladder agrees the seventh year has no price", terms.find((t) => t.years === 7)!.total === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
