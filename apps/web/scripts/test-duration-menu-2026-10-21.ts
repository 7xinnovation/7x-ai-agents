/**
 * "I asked to change the subscription period to two years. Why did you show
 *  all the options when my request was clear?"
 *
 * Reported 21 October, in the customer's own words, inside the transcript. The
 * request was answered with all five durations and "Which duration would you
 * like?" — a menu put in front of somebody who had just ordered from it.
 *
 * Run from apps/web:  npx tsx scripts/test-duration-menu-2026-10-21.ts
 */
import { durationRequested, asksToPickDuration, narrationGuard, durationChosen } from "@/lib/narrationGuard";
import { durationCardGuard, keepOnlyTerm, type Term } from "@/lib/durationCards";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

/** The ladder from the report: MyBox, as the cards showed it. */
const MYBOX: Term[] = [
  { years: 1, rent: 300, fee: 70, total: 370 },
  { years: 2, rent: 600, fee: 70, total: 670 },
  { years: 3, rent: 900, fee: 70, total: 970 },
  { years: 5, rent: 1200, fee: 70, total: 1270 },
  { years: 10, rent: 2000, fee: 70, total: 2070 },
];
const MENU = [
  "```cards",
  "- title: 1 Year",
  "  badge: EXPIRES 20-10-2027",
  "  desc: Rental AED 300.00 + registration AED 70.00",
  "  price: AED 370.00",
  "- title: 2 Years",
  "  badge: EXPIRES 20-10-2028",
  "  desc: Rental AED 600.00 + registration AED 70.00",
  "  price: AED 670.00",
  "- title: 3 Years",
  "  badge: EXPIRES 20-10-2029",
  "  desc: Rental AED 900.00 + registration AED 70.00",
  "  price: AED 970.00",
  "- title: 5 Years",
  "  desc: Rental AED 1,200.00 + registration AED 70.00",
  "  price: AED 1,270.00",
  "- title: 10 Years",
  "  desc: Rental AED 2,000.00 + registration AED 70.00",
  "  price: AED 2,070.00",
  "```",
].join("\n");

// ------------------------------------------------ did they name a term?
check("the sentence from the report", durationRequested("Mira, can I change the subscription period to two years?") === 2);
check("plainly", durationRequested("change it to 3 years") === 3);
check("switching", durationRequested("switch to 5 years please") === 5);
check("wanting", durationRequested("I want 2 years") === 2);
check("renting for a term", durationRequested("I want to rent a personal MyBox for one year.") === 1);
check("digits", durationRequested("make it 10 years") === 10);
check("Arabic", durationRequested("أريد سنتين") === 2);

// The button in the widget says exactly this. Collapsing for somebody who
// pressed it would be the same discourtesy pointing the other way.
check('"See other durations" is left alone', durationRequested("See other durations") === null);
check("asking what is available is left alone", durationRequested("what durations do you have?") === null);
check("asking to see the options is left alone", durationRequested("show me all the options") === null);
check("a comparison is not a choice", durationRequested("how much for 2 and 3 years?") === null);
check("no term named", durationRequested("Proceed to payment") === null);
check("nothing said", durationRequested("") === null);

// The strict chip-tap reader is unchanged by any of this.
check("a bare chip tap still reads as chosen", durationChosen("2 Years") === 2);
check("and the loose reader agrees with it", durationRequested("2 Years") === 2);

// ------------------------------------------------------- the menu collapses
{
  const out = keepOnlyTerm(MENU, 2);
  check("only the term they asked for survives", /- title: 2 Years/.test(out) && !/- title: 1 Year\b/.test(out) && !/- title: 10 Years/.test(out), out);
  check("...with its price intact", /price: AED 670\.00/.test(out));
  check("...and its badge", /EXPIRES 20-10-2028/.test(out));
  check("the block still closes", out.trimEnd().endsWith("```"));
}
check("a term that is not on the menu leaves it whole", keepOnlyTerm(MENU, 7) === MENU);
check("a menu of one is left alone", keepOnlyTerm("```cards\n- title: 2 Years\n  price: AED 670.00\n```", 2) === "```cards\n- title: 2 Years\n  price: AED 670.00\n```");
{
  // Branch and box cards are not a duration menu and have no business being
  // narrowed by one.
  const branches = "```cards\n- title: NXN - Umm Sequim Branch\n  desc: Dubai\n- title: NXN - Khalifa City Branch\n  desc: Abu Dhabi\n```";
  check("branch cards are untouched", keepOnlyTerm(branches, 2) === branches);
}

// -------------------------------------------------------- through the guard
{
  const run = (text: string, asked: number | null) => {
    const g = durationCardGuard(() => MYBOX, () => asked);
    let out = "";
    for (const ch of text) out += g.push(ch);
    return out + g.flush();
  };
  const asked = run(MENU, 2);
  check("streamed, the menu collapses to the term asked for", /- title: 2 Years/.test(asked) && !/- title: 3 Years/.test(asked), asked);
  const unasked = run(MENU, null);
  check("and stays whole when no term was named", /- title: 1 Year\b/.test(unasked) && /- title: 10 Years/.test(unasked));
  check("prices are still stamped while collapsing", /price: AED 670\.00/.test(asked));
}

// ------------------------------------- the question underneath the menu
check("the question from the report is recognised", asksToPickDuration("Which duration would you like?"));
check("so is the lead-in", asksToPickDuration("Of course! Here are the duration options:"));
check("and an invitation to choose", asksToPickDuration("Please choose a duration."));
check("an ordinary sentence is not", !asksToPickDuration("Your box is reserved until 20 October 2028."));
check("nor is a confirmation", !asksToPickDuration("Two years it is."));
{
  const run = (text: string, requested: number | null) => {
    const g = narrationGuard({ chosenDuration: () => null, requestedDuration: () => requested });
    let out = "";
    for (const ch of text) out += g.push(ch);
    return out + g.flush();
  };
  const reply = "Two years it is. Which duration would you like? Your box is reserved.";
  const dropped = run(reply, 2);
  check("the question is dropped once they have named a term", !/Which duration would you like\?/.test(dropped), dropped);
  check("...and the rest of the reply survives", /Two years it is\./.test(dropped) && /Your box is reserved\./.test(dropped), dropped);
  check("it stays when they named nothing", /Which duration would you like\?/.test(run(reply, null)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
