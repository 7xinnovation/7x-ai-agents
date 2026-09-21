/**
 * The mobile app bug list, 11 September — the four that are layout (2, 4, 6, 12).
 *
 * Issues 2 and 4 are one bug wearing two hats: "the message bubble text is cut
 * off at the right edge" and "the browser screen does not stay a fixed size — it
 * keeps resizing/shifting during the conversation". Nothing resizes. iOS
 * magnifies the whole page whenever a text field smaller than 16px takes focus,
 * and the fixed-position widget is then wider than what the customer can see —
 * clipped at the right at the origin, at the left once they have panned. Three
 * more screenshots in the same list show the composer cut off on the left, which
 * is the same magnification a scroll position later.
 *
 * So the rule this file enforces is not "the composer is 16px". It is that NO
 * field in the customer's widget is under 16px where the pointer is coarse —
 * including the next one somebody adds.
 *
 * Run from apps/web:  npx tsx scripts/test-mobile-layout-2026-09-17.ts
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
const receipt = readFileSync(new URL("../app/api/receipt/[reference]/route.ts", import.meta.url), "utf8");
const extReturn = readFileSync(new URL("../app/api/payments/ext-return/route.ts", import.meta.url), "utf8");

/** Below this, iOS zooms the page in when the field is focused. */
const NO_ZOOM = 16;

/**
 * Every rule in a stylesheet, as (selector, body) — brace-matched, so a
 * declaration inside an @media block is found with its own selector rather
 * than the media query's.
 */
function rules(source: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  // Comments carry braces and example CSS; they are not rules.
  const s = source.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf("{", i);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < s.length && depth > 0) {
      if (s[j] === "{") depth += 1;
      else if (s[j] === "}") depth -= 1;
      j += 1;
    }
    const selector = s.slice(i, open).trim().split("}").pop()!.trim();
    const body = s.slice(open + 1, j - 1);
    if (selector && !selector.startsWith("@")) out.push({ selector, body });
    // Descend into at-rules so their inner rules are seen with their own selectors.
    i = selector.startsWith("@") ? open + 1 : j;
  }
  return out;
}

/**
 * Is this selector a field the customer can put a caret in?
 *
 * The LAST compound decides, because that is what the rule actually styles: a
 * bare `input`/`textarea`/`select` element, or a class named for one. It is not
 * enough for the word to appear somewhere in the selector — `.dlg-input-hint`
 * is the grey line of text under the composer and `.dlg-select-title` is a
 * heading, and neither has ever taken a caret.
 */
const isField = (sel: string) => {
  if (!sel.startsWith(".dlg-")) return false;
  if (/::|\[type="color"\]/.test(sel)) return false;
  const last = sel.trim().split(/\s+/).pop() ?? "";
  if (last === ".dlg-input") return false; // the composer shell, not the field in it
  return last === "input" || last === "textarea" || last === "select" || /-input$/.test(last);
};

// The coarse-pointer block is where the phone rules live. Everything else is the
// desktop stylesheet, and that is what a field's declared size is read from.
/**
 * The coarse-pointer block, found by what it CONTAINS.
 *
 * There is more than one `(hover: none) and (pointer: coarse)` block in the
 * stylesheet, and this used to anchor on the first line of a comment inside the
 * one it wanted — so editing that comment silently emptied the block and half
 * this file started failing for a reason that had nothing to do with the CSS.
 * The composer is what identifies it.
 */
function coarseBlockContaining(needle: string): { at: number; text: string } {
  const OPEN = "@media (hover: none) and (pointer: coarse) {";
  for (let at = css.indexOf(OPEN); at !== -1; at = css.indexOf(OPEN, at + 1)) {
    let depth = 0;
    let i = css.indexOf("{", at);
    const start = i;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    const text = css.slice(at, i + 1);
    if (text.includes(needle)) return { at, text };
    void start;
  }
  throw new Error(`no coarse-pointer block contains ${needle}`);
}
const { at: COARSE_AT, text: coarseBlock } = coarseBlockContaining(".dlg-input textarea");
const desktop = css.slice(0, COARSE_AT) + css.slice(COARSE_AT + coarseBlock.length);

console.log("\nEvery field the customer types into (issues 2 and 4)");
check("there is a coarse-pointer block for the fields", COARSE_AT > 0 && coarseBlock.length > 50, coarseBlock.slice(0, 60));

const fields = new Map<string, number>();
for (const { selector, body } of rules(desktop)) {
  if (!isField(selector)) continue;
  const m = /font-size:\s*([\d.]+)px/.exec(body);
  if (m) for (const one of selector.split(",")) if (isField(one.trim())) fields.set(one.trim(), Number(m[1]));
}
check("the stylesheet was parsed at all", fields.size >= 4, [...fields.keys()]);

for (const [selector, size] of fields) {
  if (size >= NO_ZOOM) { check(`${selector} is ${size}px everywhere`, true); continue; }
  check(`${selector} is ${size}px on desktop and lifted on a phone`, coarseBlock.includes(selector), { selector, size });
}
check("...and the lift is to 16px, not to something else", /font-size:\s*16px/.test(coarseBlock), coarseBlock);

console.log("\nThe two white lines beside the send button (issue 6)");
check("the glass composer drops its backdrop filter on a phone", /\.dlg-input \{[^}]*backdrop-filter:\s*none/.test(coarseBlock), coarseBlock);
check("...and is given an opaque background in its place", /\.dlg-input \{[^}]*background:\s*var\(--c-surface\)/.test(coarseBlock));
check("the desktop composer keeps its glass", /\.dlg-input \{[\s\S]{0,400}?backdrop-filter: blur\(10px\)/.test(desktop));

console.log("\nWide content stays inside the phone (17 September, round two)");
// The bubble must be ALLOWED to be narrower than what is in it — a flex item
// keeps its content's width unless told otherwise, so `max-width: 86%` capped
// the box and the table inside it overflowed anyway.
for (const [what, sel] of [["the message row", ".dlg-msg"], ["the bubble", ".dlg-bubble"]] as const) {
  const rule = rules(css).find((r) => r.selector === sel);
  check(`${what} may shrink below its content`, /min-width:\s*0/.test(rule?.body ?? ""), rule?.body?.slice(0, 120));
}
{
  const wrap = rules(css).find((r) => r.selector === ".dlg-md-tablewrap")?.body ?? "";
  check("a wide table scrolls inside its card", /overflow-x:\s*auto/.test(wrap), wrap.slice(0, 200));
  check("...and is not clipped by it", !/overflow:\s*hidden/.test(wrap), wrap.slice(0, 200));
  check("...and cannot be wider than the bubble", /max-width:\s*100%/.test(wrap));
}
{
  const cells = rules(css).find((r) => r.selector === ".dlg-md-table th,\n.dlg-md-table td")
    ?? rules(css).find((r) => r.selector.includes(".dlg-md-table td"));
  check('"450367" is not broken into "45 03 67"', /word-break:\s*normal/.test(cells?.body ?? ""), cells?.selector);
}
{
  const list = rules(css).find((r) => r.selector === ".dlg-messages")?.body ?? "";
  check("one wide message cannot make the conversation pannable", /overflow-x:\s*hidden/.test(list), list.slice(0, 200));
}
{
  const btn = rules(css).find((r) => r.selector === ".dlg-chat-btn")?.body ?? "";
  check("a long option label wraps instead of overflowing", !/white-space:\s*nowrap/.test(btn), btn.slice(0, 200));
  check("...inside a pill no wider than the bubble", /max-width:\s*100%/.test(btn));
}

console.log("\nThe expand icon that does nothing on a phone (issue 12)");
check("there is a rule that hides it", /\.dlg-chip\.icon-only\.expand-toggle \{\s*display: none;/.test(css));
/**
 * AND IT KEYS ON THE POINTER, NOT THE WIDTH.
 *
 * The rule has existed since FB-5 under `max-width: 599px` and matched nothing,
 * because the button never carried the class. Giving it the class on 17
 * September woke it in the wrong place: the widget's viewport is the IFRAME's,
 * and a floating launcher is about 520px wide on any desktop — so it hid the
 * control on every desktop embed, which is the one place expanding does
 * something. Reported on both epgl.ae and emiratespost.ae.
 */
check("...on a touch device", coarseBlock.includes(".dlg-chip.icon-only.expand-toggle"), coarseBlock.slice(0, 60));
check("...and NOT on a narrow viewport", !/expand-toggle/.test(css.slice(css.indexOf("@media (max-width: 599px)"), css.indexOf("@media (max-width: 599px)") + 2000)));
check("the button now actually carries that class", /className="dlg-chip icon-only expand-toggle"/.test(exp));
check("...and is not rendered at all with no host frame to expand into", /embedded && canExpand \?/.test(exp));
check("which is what canExpand means", /!isNative\(\) && window\.parent !== window/.test(exp));

console.log("\nThe pages outside the widget need the same 16px (they are tapped too)");
check("the receipt's Print button", /font-size:16px/.test(receipt), receipt.match(/\.print\{[^}]*\}/)?.[0]);
check("the payment return's Back button", /font-size:16px/.test(extReturn), extReturn.match(/a\.done\{[^}]*\}/)?.[0]);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
