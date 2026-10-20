/**
 * "Sources" is per agent: EPGL hides it, everybody else keeps it.
 *
 *   npx tsx scripts/test-show-sources-2026-10-20.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentDefinition } from "@dialog/config";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, rel), "utf8");
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
}

console.log("\nThe default is unchanged behaviour");
// The field alone, rather than a whole definition: this is a question about the
// default, and a full fixture would be twenty lines of unrelated required keys.
const field = AgentDefinition.shape.showSources;
check("an agent that says nothing still shows its sources", field.parse(undefined) === true);
check("...and one that asks for them off gets them off", field.parse(false) === false);
check("...and the flag is a boolean", field.safeParse("no").success === false);

console.log("\nWhat the widget is told, and what it does with it");
const page = src("../app/embed/[agent]/page.tsx");
check("the flag reaches the client", /showSources: d\.showSources \?\? true,/.test(page));
const exp = src("../app/embed/[agent]/Experience.tsx");
check("the chips are gated on it", /m\.citations\?\.length && agent\.showSources !== false \?/.test(exp));
check("...and an agent without the field is unaffected", /!== false/.test(exp));
check("the label is still there for the agents that keep them", /dlg-sources-label/.test(exp));

console.log("\nOnly the display changes");
check("the server still emits citations", /ev\.type === "citation"/.test(src("../app/api/chat/route.ts")));
const script = src("./epgl-hide-sources-2026-10-20.ts");
check("the script touches EPGL only", /"epgl-dialog": false,/.test(script) && !/nxn-dialog/.test(script));
check("...is idempotent", /if \(had === want\)/.test(script));
check("...and has a dry run", /--dry-run/.test(script));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
