/**
 * When a run of buttons stops being a set of choices (17 September screenshots).
 *
 * Run from apps/web:  npx tsx scripts/test-option-pile-2026-09-17.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};

// The rule, lifted verbatim from Markdown.tsx so the test breaks if it drifts.
const src = readFileSync(new URL("../app/embed/[agent]/Markdown.tsx", import.meta.url), "utf8");
const body = src.slice(src.indexOf("function isAPile"), src.indexOf("const SELECT_STR"));
check("the rule is where the test thinks it is", body.includes("BUTTON_LIST_MAX"), body.slice(0, 60));
const isAPile: (l: string[]) => boolean = new Function(
  "BUTTON_LIST_MAX", "LONG_LABEL", "LONG_LABEL_LIST_MAX",
  `${body.replace(/function isAPile\(labels: string\[\]\): boolean/, "function isAPile(labels)")}; return isAPile;`
)(12, 24, 5);

console.log("\nThe list that was reported (twelve boxes, each with bundle and branch)");
const boxes = [
  "450367 (MyHome Flex, Al Barsha)", "902020 (MyHome 3, Dubai Sorting Centre)",
  "450293 (Instant, Al Barsha)", "901961 (MyHome 3, Dubai Sorting Centre)",
  "417676 (Business, Al Badaa - Corporate)", "417377 (Large Instant, Al Badaa - Corporate)",
  "450294 (Instant, Al Barsha)", "450776 (Instant, Al Barsha)", "450391 (Instant, Al Barsha)",
  "450152 (Instant, Al Barsha)", "450822 (Instant, Al Barsha)", "450394 (MyHome Flex, Al Barsha)",
];
check("twelve long labels collapse into the searchable list", isAPile(boxes), boxes.length);

console.log("\nWhat must stay as buttons");
for (const [what, labels] of [
  ["a yes/no", ["Yes, renew my PO Box", "No, something else"]],
  ["the pulse's own closing offer", ["Renew a box", "Rent a new box", "Manage a box", "Nothing right now"]],
  ["the three bundles", ["MyBox", "MyHome", "MyHome Instant"]],
  ["five durations", ["1 Year", "2 Years", "3 Years", "5 Years", "10 Years"]],
  ["five emirates", ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah"]],
  ["six short chips", ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Fujairah", "Umm Al Quwain"]],
  ["twelve short chips", Array.from({ length: 12 }, (_, i) => `Option ${i + 1}`)],
] as const) {
  check(`${what} stays a set of buttons`, !isAPile([...labels]), labels.length);
}

console.log("\nAnd what must collapse");
for (const [what, labels] of [
  ["sixty licensing authorities", Array.from({ length: 60 }, (_, i) => `Authority ${i + 1}`)],
  ["thirteen short chips", Array.from({ length: 13 }, (_, i) => `Option ${i + 1}`)],
  ["six branches with hours", [
    "Dubai Central Post Office - open until 20:00", "Union Square Post Office - open until 15:30",
    "Naif Post Office - open until 20:00", "Al Rashidiyah Post Office - open until 15:30",
    "Al Barsha Post Office - closed, opens 08:00", "Al Quoz Fourth Post Office - open until 15:30",
  ]],
] as const) {
  check(`${what} collapses`, isAPile([...labels]), labels.length);
}

console.log("\nThe boundary, stated");
check("five long labels are still a set", !isAPile(Array.from({ length: 5 }, () => "450367 (MyHome Flex, Al Barsha)")));
check("six long labels are a pile", isAPile(Array.from({ length: 6 }, () => "450367 (MyHome Flex, Al Barsha)")));
check("an empty list is neither", !isAPile([]));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
