/**
 * "Refresh" shows the NEXT ten box numbers (2026-09-07).
 *
 * Rental/FreeBoxes takes a bundle and a location and nothing else — no page, no
 * offset, no cursor — so every call returns the same list, Refresh included.
 * The journey shows ten at a time, and which ten had not been shown yet was left
 * to the model to work out across turns from an identical payload. Dubai Central
 * has 41 free boxes on production; a customer pressing Refresh could be handed
 * the same ten again and reasonably conclude the rest never load.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-box-paging-2026-09-07.ts
 */
import { nextBoxPage, BOXES_PER_PAGE } from "@/lib/integrations";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

// 41 free boxes, as Dubai Central actually has.
const all = Array.from({ length: 41 }, (_, i) => String(450000 + i));
const conv = `test-${Math.random()}`;

const p1 = nextBoxPage(conv, "IN", "201", all);
check("the first call offers ten", p1.page.length === BOXES_PER_PAGE, p1.page.length);
check("...from the top of the list", p1.page[0] === "450000");
check("...and says how many are left", p1.remaining === 31, p1.remaining);
check("nothing had been shown before", p1.shownBefore === 0);

const p2 = nextBoxPage(conv, "IN", "201", all);
check("the SECOND call offers ten DIFFERENT numbers", p2.page.every((b) => !p1.page.includes(b)), p2.page);
check("...continuing where the first stopped", p2.page[0] === "450010", p2.page[0]);
check("...and counts what was already shown", p2.shownBefore === 10, p2.shownBefore);

const p3 = nextBoxPage(conv, "IN", "201", all);
const p4 = nextBoxPage(conv, "IN", "201", all);
const seen = [...p1.page, ...p2.page, ...p3.page, ...p4.page];
check("four pages show forty distinct numbers", new Set(seen).size === 40, new Set(seen).size);
check("the fourth page is not yet exhausted", !p4.exhausted);

const p5 = nextBoxPage(conv, "IN", "201", all);
check("the fifth offers the one that is left", p5.page.length === 1 && p5.page[0] === "450040", p5.page);

const p6 = nextBoxPage(conv, "IN", "201", all);
check("once every number has been shown, it says so", p6.exhausted === true);
check("...and starts again rather than showing nothing", p6.page.length === BOXES_PER_PAGE, p6.page.length);

// A DIFFERENT BRANCH is a different list.
const other = nextBoxPage(conv, "IN", "244", all);
check("another branch starts from the beginning", other.page[0] === "450000" && other.shownBefore === 0);

// And a different CUSTOMER never inherits someone else's page.
const stranger = nextBoxPage(`other-${Math.random()}`, "IN", "201", all);
check("another conversation starts from the beginning", stranger.page[0] === "450000" && stranger.shownBefore === 0);

// Small branches: one with a single box, and one with none.
const tiny = nextBoxPage(`t-${Math.random()}`, "IN", "219", ["450999"]);
check("a branch with one box offers that one", tiny.page.length === 1 && tiny.remaining === 0);
const none = nextBoxPage(`n-${Math.random()}`, "IN", "999", []);
check("a branch with none offers none", none.page.length === 0 && !none.exhausted);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
