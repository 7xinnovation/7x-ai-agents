/**
 * An Arabic branch name has to resolve to an officeId too.
 *
 * A three-year MyHome at Dubai Central, AED 2,155, held and never saved —
 * three attempts, all in Arabic, on 10 September. Each one carried
 * "No deliveryOfficeID could be resolved" and then timed out.
 *
 * The case held the branch as the customer saw it: "مكتب بريد دبي المركزي".
 * The directory indexed nameEn only. So the lookup missed, deliveryOfficeID was
 * never filled in, and Emirates Post had nowhere to deliver the box to.
 *
 * The Arabic names share long prefixes — "مكتب بريد …" and "الشبكة الوطنية …" —
 * so the loose prefix match that made "Naif" work for "Naif Post Office" would
 * now happily return the first Dubai branch for the word "post office". That is
 * the second half of this.
 *
 * Run from apps/web:  npx tsx scripts/test-arabic-branch-office-2026-09-10.ts
 */
export {};

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

const { readFileSync } = await import("node:fs");
const src = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
const remember = src.slice(src.indexOf("function rememberBranches"), src.indexOf("/** The branches this conversation was actually shown"));
const lookup = src.slice(src.indexOf("function officeIdForBranch"), src.indexOf("const hallMemory"));

console.log("\nBoth names are indexed");
check("nameAr is read off the branch row", /const ar = String\(r\.nameAr \?\? ""\)\.trim\(\)/.test(remember));
check("...and indexed to the same officeId", /if \(ar\) cur\[ar\.toLowerCase\(\)\] = id/.test(remember));
check("nameEn is still indexed", /cur\[name\.toLowerCase\(\)\] = id/.test(remember));
check("the row type admits nameAr", /nameAr\?: unknown/.test(remember));
check("byId still keeps the English name", /ids\[id\] = name/.test(remember));

console.log("\nA shared prefix resolves to nothing, not to the first match");
check("candidates are collected, not short-circuited", /const ids = new Set\(/.test(lookup));
check("...and only a single answer is returned", /ids\.size === 1/.test(lookup));
check("an exact match still wins outright", /if \(hit\.byName\[name\]\) return hit\.byName\[name\]!/.test(lookup));

console.log("\nThe behaviour, on the real Dubai list");
// The names Emirates Post actually return for DXB, read off production today.
const DXB: [string, string, string][] = [
  ["201", "NXN - Dubai Central Branch", "الشبكة الوطنية - فرع دبي المركزي"],
  ["214", "Naif Post Office", "مكتب بريد نايف"],
  ["202", "Union Square Post Office", "مكتب بريد ميدان الإتحاد"],
  ["244", "NXN - Al Barsha Branch", "الشبكة الوطنية - فرع البرشاء"],
];
const byName: Record<string, string> = {};
for (const [id, en, ar] of DXB) { byName[en.toLowerCase()] = id; byName[ar.toLowerCase()] = id; }
const resolve = (branch: string): string | null => {
  const name = branch.trim().toLowerCase();
  if (byName[name]) return byName[name]!;
  const ids = new Set(Object.entries(byName).filter(([k]) => k.startsWith(name) || name.startsWith(k)).map(([, v]) => v));
  return ids.size === 1 ? [...ids][0]! : null;
};

check("the Arabic name the customer saw resolves", resolve("الشبكة الوطنية - فرع دبي المركزي") === "201", resolve("الشبكة الوطنية - فرع دبي المركزي"));
check("the English name still resolves", resolve("NXN - Dubai Central Branch") === "201");
check("case and spacing do not matter", resolve("  naif post office  ") === "214");
check("a short unambiguous English prefix still resolves", resolve("Naif") === "214", resolve("Naif"));
check("an Arabic prefix shared by two branches resolves to nothing", resolve("مكتب بريد") === null, resolve("مكتب بريد"));
check("...rather than confidently to the first of them", resolve("مكتب بريد") !== "214");
check("an unambiguous Arabic prefix does resolve", resolve("مكتب بريد نايف") === "214", resolve("مكتب بريد نايف"));
check("a branch that was never shown resolves to nothing", resolve("Some Other Branch") === null);
check("an empty branch resolves to nothing", resolve("") === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
