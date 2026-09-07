/**
 * The duration cards are stamped, not trusted (2026-09-06).
 *
 * Rental/Bundle prices one year and nothing longer on the personal bundles, so a
 * five-year card can only be priced from a term Emirates Post has actually
 * charged for. Multiplying the annual rate is not an approximation of that: MyHome
 * Instant's five years is 4,000, not 4,975 — a customer comparing us against
 * emiratespost.ae is out by 975 dirhams before they start.
 *
 * The tool result says this in as many words, and the cards were still written
 * from the annual rate. So they are held to the ladder that was priced.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-duration-cards-2026-09-06.ts
 */
import { durationCardGuard, stampDurationCards, yearsInTitle, type Term } from "@/lib/durationCards";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};
const run = (text: string, terms: Term[] | null) => {
  const g = durationCardGuard(() => terms);
  let out = "";
  for (const ch of text) out += g.push(ch);
  return out + g.flush();
};

/** MyHome Instant as Emirates Post actually prices it, measured 6 Sep. */
const INSTANT: Term[] = [
  { years: 1, rent: 995, fee: 70, total: 1065 },
  { years: 2, rent: 1990, fee: 70, total: 2060 },
  { years: 3, rent: 2985, fee: 70, total: 3055 },
  { years: 5, rent: 4000, fee: 70, total: 4070 },
  { years: 10, rent: 7000, fee: 70, total: 7070 },
];

// ── which cards are duration cards ──────────────────────────────────────────
check("'5 Years' is a term", yearsInTitle("5 Years") === 5);
check("'1 Year' is a term", yearsInTitle("1 Year") === 1);
check("'10 years (expires 05-09-2036)' is a term", yearsInTitle("10 years (expires 05-09-2036)") === 10);
check("a bundle name is not", yearsInTitle("MyHome Instant") === null);
check("a box number is not", yearsInTitle("914555") === null);
check("a branch is not", yearsInTitle("Al Barsha Post Office") === null);

// ── the reported card: the annual rate multiplied out ───────────────────────
const WRONG = [
  "```cards",
  "- title: 3 Years",
  "  price: AED 3,055.00",
  "  desc: Rental AED 2,985.00 + registration AED 70.00",
  "- title: 5 Years",
  "  price: AED 5,045.00",
  "  desc: Rental AED 4,975.00 + registration AED 70.00",
  "- title: 10 Years",
  "  price: AED 10,020.00",
  "  desc: Rental AED 9,950.00 + registration AED 70.00",
  "```",
].join("\n");
const fixed = run(WRONG, INSTANT);
check("five years becomes the 4,070 Emirates Post charges", /- title: 5 Years\n  price: AED 4,070\.00/.test(fixed), fixed);
check("...and its breakdown with it", /Rental AED 4,000\.00 \+ registration AED 70\.00/.test(fixed), fixed);
check("ten years becomes 7,070", /- title: 10 Years\n  price: AED 7,070\.00/.test(fixed), fixed);
check("a term that was already right is unchanged", /- title: 3 Years\n  price: AED 3,055\.00/.test(fixed));
check("4,975 is gone", !/4,975/.test(fixed));
check("9,950 is gone", !/9,950/.test(fixed));

// ── the breakdown is stated ONCE ────────────────────────────────────────────
// UAT, corporate Basic Box: the 2, 3 and 5-year cards each carried a highlighted
// pill repeating the sentence already in the card body. 1 and 10 years did not,
// because the model had not given those a badge. Every money-carrying line was
// being rewritten to the same text.
const TWICE = [
  "```cards",
  "- title: 2 Years",
  "  badge: Rental AED 1,595.00 + registration AED 70.00",
  "  desc: Rental AED 1,595.00 + registration AED 70.00",
  "  price: AED 1,665.00",
  "- title: 3 Years",
  "  desc: Rental AED 2,095.00 + registration AED 70.00",
  "  price: AED 2,165.00",
  "```",
].join("\n");
const CORPORATE: Term[] = [
  { years: 2, rent: 1595, fee: 70, total: 1665 },
  { years: 3, rent: 2095, fee: 70, total: 2165 },
];
const once = run(TWICE, CORPORATE);
check("the breakdown appears once, not twice", (once.match(/Rental AED 1,595\.00/g) ?? []).length === 1, once);
check("...and the empty line it left is gone", !/^\s*badge:\s*$/m.test(once), once);
check("the card keeps its price", /price: AED 1,665\.00/.test(once));
check("a card with only one breakdown is unaffected", (once.match(/Rental AED 2,095\.00/g) ?? []).length === 1, once);

// A badge that says something of its OWN survives, minus the figures.
const SAVING = "```cards\n- title: 5 Years\n  badge: Save AED 1,305 vs 5 x 1-year\n  desc: Rental AED 4,200.00 + registration AED 70.00\n  price: AED 4,270.00\n```";
const kept = run(SAVING, [{ years: 5, rent: 4200, fee: 70, total: 4270 }]);
check("a badge with its own words keeps them", /badge: Save/.test(kept), kept);
check("...without a second set of figures", (kept.match(/AED 4,200/g) ?? []).length === 1, kept);

// ── a term nobody has ever been charged for ─────────────────────────────────
const UNPRICED: Term[] = [
  { years: 1, rent: 995, fee: 70, total: 1065 },
  { years: 5, rent: null, fee: 70, total: null },
];
const blanked = run(WRONG.replace("3 Years", "1 Year").replace("10 Years", "1 Year"), UNPRICED);
check("an unpriced term says so instead of guessing", /- title: 5 Years\n  price: Confirmed when the box is reserved/.test(blanked), blanked);
check("...and carries no AED anywhere", !/5 Years[\s\S]*?AED/.test(blanked.split("- title: 1 Year")[2] ?? blanked), blanked);
check("the priced term beside it is still priced", /price: AED 1,065\.00/.test(blanked));

// ── everything else goes past ───────────────────────────────────────────────
const BUNDLES = "```cards\n- title: MyHome Instant\n  price: AED 995 / year\n  pricenote: + AED 70 one-time registration fee\n```";
check("bundle cards are not touched", run(BUNDLES, INSTANT) === BUNDLES);
const BRANCHES = "```cards\n- title: Naif Post Office\n  desc: Mon-Fri, 08:00-15:30\n```";
check("branch cards are not touched", run(BRANCHES, INSTANT) === BRANCHES);
check("with no ladder nothing is stamped", run(WRONG, null) === WRONG);
check("prose is passed through byte for byte", run("How long would you like to rent for?", INSTANT) === "How long would you like to rent for?");

// ── streaming ───────────────────────────────────────────────────────────────
const chunked = (() => {
  const g = durationCardGuard(() => INSTANT);
  let out = "";
  for (let i = 0; i < WRONG.length; i += 7) out += g.push(WRONG.slice(i, i + 7));
  return out + g.flush();
})();
check("the same in seven-byte chunks", chunked === fixed, chunked);
check("nothing is lost around the block", run(`before\n\n${WRONG}\n\nafter`, INSTANT).startsWith("before") && run(`before\n\n${WRONG}\n\nafter`, INSTANT).endsWith("after"));

// The whole ladder, verbatim as the live agent now produces it.
const LIVE = ["```cards", ...INSTANT.map((t) => `- title: ${t.years} Year${t.years === 1 ? "" : "s"}\n  price: AED ${t.total!.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n  desc: Rental AED ${t.rent!.toLocaleString("en-US", { minimumFractionDigits: 2 })} + registration AED 70.00`), "```"].join("\n");
check("a correct ladder survives untouched", run(LIVE, INSTANT) === LIVE, run(LIVE, INSTANT));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
