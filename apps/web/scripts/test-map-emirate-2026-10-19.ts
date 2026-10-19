/**
 * Regression for the 19 October bug report: "Couldn't load the map" after
 * allowing location, above a branch list that was intact.
 *
 * The map block is written by the model. `emirate: Dubai` reached the branches
 * route as "DUBAI", which was not one of the seven codes, so the route answered
 * 400 and ChatMap showed the one failure message it has. Verified against
 * production the same day: DXB returned 16 branches in 0.57 s while "Dubai"
 * returned 400, and every emirate's endpoint was healthy.
 *
 *   npx tsx scripts/test-map-emirate-2026-10-19.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toEmirateCode, EMIRATE_CODES, EMIRATE_LABEL } from "../lib/emirates";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, rel), "utf8");
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
}

console.log("\nThe code is still the code");
for (const c of EMIRATE_CODES) check(`${c} is itself`, toEmirateCode(c) === c);
check("lower case is the code too", toEmirateCode("dxb") === "DXB" && toEmirateCode(" auh ") === "AUH");

console.log("\nThe name the model actually wrote");
check("Dubai — the reported one", toEmirateCode("Dubai") === "DXB");
check("the parser upper-cases first, so DUBAI must work", toEmirateCode("DUBAI") === "DXB");
check("Abu Dhabi, spaced, hyphenated and run together", toEmirateCode("Abu Dhabi") === "AUH" && toEmirateCode("abu-dhabi") === "AUH" && toEmirateCode("ABUDHABI") === "AUH");
check("Umm Al Quwain and its other spellings", toEmirateCode("Umm Al Quwain") === "UAQ" && toEmirateCode("Umm Al Qaiwain") === "UAQ");
check("Ras Al Khaimah with and without the final h", toEmirateCode("Ras Al Khaimah") === "RAK" && toEmirateCode("Ras Al Khaima") === "RAK");
check("Al Fujairah, Sharjah, Ajman", toEmirateCode("Al Fujairah") === "FUJ" && toEmirateCode("Sharjah") === "SHJ" && toEmirateCode("Ajman") === "AJM");
check("Al Ain is Abu Dhabi: Emirates Post has no code of its own for it", toEmirateCode("Al Ain") === "AUH");

console.log("\nArabic, which the conversation may be held in");
check("دبي and أبوظبي", toEmirateCode("دبي") === "DXB" && toEmirateCode("أبوظبي") === "AUH" && toEmirateCode("أبو ظبي") === "AUH");
check("the alef and the final taa are not a distinction", toEmirateCode("الشارقة") === "SHJ" && toEmirateCode("الشارقه") === "SHJ" && toEmirateCode("راس الخيمة") === "RAK");
check("عجمان, أم القيوين, الفجيرة", toEmirateCode("عجمان") === "AJM" && toEmirateCode("أم القيوين") === "UAQ" && toEmirateCode("الفجيرة") === "FUJ");

console.log("\nNobody's emirate is still nobody's");
check("empty, blank and absent", toEmirateCode("") === null && toEmirateCode("   ") === null && toEmirateCode(null) === null && toEmirateCode(undefined) === null);
check("a place that is not an emirate", toEmirateCode("Al Barsha") === null && toEmirateCode("Riyadh") === null && toEmirateCode("UAE") === null);
check("a bundle id in the wrong line is not an emirate", toEmirateCode("MYHOME3") === null && toEmirateCode("IN") === null);

console.log("\nWhere it is used");
const route = src("../app/api/nxn/branches/route.ts");
check("the route translates before it refuses", /toEmirateCode\(asked\)/.test(route) && !/new Set\(\["AUH"/.test(route));
check("a refusal is logged, because this failure is invisible otherwise", /log\.warn\("nxn_branches_bad_request"/.test(route));
const md = src("../app/embed/[agent]/Markdown.tsx");
check("a map block with an unreadable emirate renders nothing at all", /const mCode = toEmirateCode\(mEmirate\);/.test(md) && /onSelect && mCode && mBundle/.test(md));
const map = src("../app/embed/[agent]/ChatMap.tsx");
check("the widget fetches by code and has no second copy of the names", /emirate=\$\{encodeURIComponent\(code \?\? emirate\)\}/.test(map) && !/const EMIRATE_NAME/.test(map));
check("the heading still names the emirate", /EMIRATE_LABEL\[code\]/.test(map));
check("every code has a label in both languages", EMIRATE_CODES.every((c) => EMIRATE_LABEL[c].en && EMIRATE_LABEL[c].ar));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
