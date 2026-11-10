/**
 * EPGL 2.0 test round, BUG-177 to BUG-183 (9 November 2026).
 * Run from apps/web: npx tsx scripts/test-epgl20-bugs-177-183-2026-11-09.ts
 */
import { readFileSync } from "node:fs";
import {
  productOptions, canonicalProductBlock, productCardGuard, productDescription, productDefaults, isPermit, productFromMessage, isProductMenu,
} from "../lib/productCards";
import { epgl20ConductDirective } from "../lib/batchUpload";
import type { AgentDefinition } from "@dialog/config";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got).slice(0, 500)}`}`); }
};
const def = JSON.parse(readFileSync(new URL("./fixtures/epgl-dialog-2.stg.2026-11-06.json", import.meta.url), "utf8")) as AgentDefinition;
const en = productOptions(def, "en");
const ar = productOptions(def, "ar");
const menu = canonicalProductBlock(en, "en");
const menuAr = canonicalProductBlock(ar, "ar");

console.log("BUG-177: licences and permits apart");
check("ten products in the fixture", en.length === 10, en.length);
check("LOCKERS and OUTSOURCE are the permits, as the catalogue designates them",
  en.filter((o) => isPermit(o.code)).map((o) => o.code).join() === "LOCKERS,OUTSOURCE");
const li = menu.indexOf("**Licences**"), pi = menu.indexOf("**Permits**");
check("the menu has a Licences heading, then a Permits heading", li === 0 && pi > li, menu.slice(0, 80));
const licBlock = menu.slice(li, pi), permBlock = menu.slice(pi);
check("every licence is under Licences", en.filter((o) => !isPermit(o.code)).every((o) => licBlock.includes(`title: ${o.label}\n`)));
check("every permit is under Permits, and only there", en.filter((o) => isPermit(o.code)).every((o) => permBlock.includes(o.label) && !licBlock.includes(o.label)));
check("two cards blocks", menu.split("```cards").length === 3);
check("Arabic headings", menuAr.startsWith("**التراخيص**") && menuAr.includes("**التصاريح**"));
check("no key row on any card", !/\bkey:/.test(menu));

console.log("BUG-178: SME in the CEP descriptions");
for (const o of en.filter((o) => o.code.startsWith("CEP30"))) {
  const d = productDescription(o.code, "en") ?? "";
  const sme = o.code.includes("-SME-");
  check(`${o.code}: description ${sme ? "says SME" : "says it is not for SMEs"}, the 30 kg limit and the scope`,
    /SME/.test(d) && (sme ? !/not SMEs/.test(d) : /not SMEs/.test(d)) && /30 kg/.test(d) && (o.code.endsWith("INTL") ? /internationally/.test(d) : /UAE only/.test(d)), d);
}
check("SME cards carry an SME badge, General ones do not",
  (menu.match(/badge: SME/g) ?? []).length === 4);
check("every product has a description in both languages", en.every((o) => productDescription(o.code, "en") && productDescription(o.code, "ar")));
check("a tap on a title still resolves to its code", en.every((o) => productFromMessage(def, o.label) === o.code) && ar.every((o) => productFromMessage(def, o.label) === o.code));
check("the canonical menu is itself recognised as the menu", isProductMenu(menu.slice(menu.indexOf("```cards")), en));

console.log("BUG-179: one menu, the same every time");
const run = (text: string, size: number) => {
  const g = productCardGuard(() => en, () => "en");
  let out = "";
  for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size));
  return out + g.flush();
};
const grouped = "Which licence?\n\n```cards\n- title: CEP Licence (≤30 kg)\n  badge: MOST COMMON\n  desc: Courier and express parcels\n- title: Food and Medicine Delivery (FOODMED)\n- title: Intermediation (INTERMED)\n```\n";
for (const size of [1, 7, 4096]) check(`a grouped five-card menu becomes the catalogue (${size}-char pieces)`, run(grouped, size) === `Which licence?\n\n${menu}\n`, run(grouped, size));
const split = "Licences:\n```cards\n- title: CEP30-GEN-DOM\n- title: FOODMED\n```\nPermits:\n```cards\n- title: LOCKERS\n```\n";
const s = run(split, 5);
check("a model's own two blocks give ONE menu, not two", s.split("**Licences**").length === 2 && s.split("```cards").length === 3, s);
const other = "Pick a duration:\n```cards\n- title: 1 year\n- title: 2 years\n```\n";
check("other cards pass untouched", run(other, 3) === other);

console.log("BUG-180 / BUG-182: the weight is not a question");
check("CEP30 with no weight: 30 is filled", productDefaults("CEP30-UAE-SME-INTL", {}).declared_max_shipment_weight_kg === 30);
check("a weight already recorded is kept", Object.keys(productDefaults("CEP30-GEN-DOM", { declared_max_shipment_weight_kg: 45 })).length === 0);
check("not for a non-CEP product", Object.keys(productDefaults("FOODMED", {})).length === 0);
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
check("the chat route fills the defaults", /productDefaults\(code, data\)/.test(route));

console.log("BUG-181 / 182 / 183: how it asks");
const dir = epgl20ConductDirective("CEP30-UAE-SME-INTL", "en");
check("one question per message, no 'yes to all' or 'yes to both'", /ONE QUESTION PER MESSAGE/.test(dir) && /Yes to all/.test(dir) && /Yes to both/.test(dir));
check("the tapped card is not re-confirmed", /do NOT ask them to confirm/.test(dir) && dir.includes("CEP30-UAE-SME-INTL"));
check("weight is never asked", /NEVER ASK ABOUT SHIPMENT WEIGHT/.test(dir));
check("ID documents on file are not asked for again", /never asked for again/.test(dir));
check("working days, never 'same day'", /WORKING DAYS/.test(dir) && /one working day/.test(dir) && /Never say 'same day'/.test(dir));
check("Arabic gets the Arabic figure", epgl20ConductDirective(null, "ar").includes("يوم عمل واحد"));
check("before a product, no product sentence", !epgl20ConductDirective(null, "en").includes("They have chosen"));
check("the route adds it before the product on applying turns", /if \(applying && !hasProduct\) directive \+= epgl20ConductDirective\(null/.test(route));
const after = route.slice(route.indexOf("if (isPulse) pulseDirective += directive;"));
check("...and on EVERY turn once the product is chosen, upload turns included (outside the typed-turn branch)",
  /^\s*if \(isPulse\) pulseDirective \+= directive;\n\s*\}\n\s*\}\n[\s\S]{0,600}if \(hasProduct\) \{\n[^\n]*\n\s*const conduct =\s*epgl20ConductDirective/.test(after));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
