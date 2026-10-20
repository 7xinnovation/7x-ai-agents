/**
 * Emirates Post asked to be able to tell our transactions from their website's.
 *
 * Their PO Box APIs carry a source on the request and their own site sends
 * "Web". Their API team asked for a distinct value for the assistant, so a
 * rental or renewal made here can be identified in their reporting.
 *
 * REVISED 20 October 2026, against their live production swagger. Two things
 * this file used to assert were wrong, and the stamp was being discarded:
 *
 *   - the field is `requestSource` on every save schema (SavePoBox, SaveRenewal,
 *     SaveTijari, SaveAgent, ProcessPayment, SaveChangeAddress), and `source` on
 *     a few card/device ones. There is no top-level `Source`, and all of them
 *     are additionalProperties:false — so the `Source` we were writing was not
 *     an extra field, it was an invalid one.
 *   - the value is `PoBoxAIBot`. They added it to their own enum for us:
 *     Web | Mobile | AutoRenewJobEngine | Wayn | Escher | PoBoxAIBot.
 *     "ChatBot" was never one of them.
 *
 * Run from apps/web:  npx tsx scripts/test-request-source-2026-09-08.ts
 */
export {};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const { readFileSync } = await import("node:fs");
const src = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");
const block = src.slice(src.indexOf("TELL EMIRATES POST WHICH TRANSACTIONS ARE OURS"), src.indexOf("// Decrypt stored secrets only at the moment"));

console.log("\nWhat is sent, and where");
check("the value is the one in their enum", /const REQUEST_SOURCE = process\.env\.NXN_REQUEST_SOURCE \|\| "PoBoxAIBot"/.test(src));
// Named in the comment above the constant as the thing it must not be, so the
// test looks for an assignment rather than the word.
check("...and never the one that was not", !/(=|\|\|)\s*"ChatBot"/.test(src));
check("...and can be changed without a deploy", /process\.env\.NXN_REQUEST_SOURCE/.test(src));
check("it is written under the name their schema declares", /body\[field\] = REQUEST_SOURCE/.test(block));
check("...which is read off this operation's own body schema", /const field = sourceFieldOf\(entry\.op\);/.test(block));
check("...and nothing is stamped where no field is declared", /if \(field && b && typeof b === "object"/.test(block));

console.log("\nOnly Emirates Post, and only their transactions");
check("scoped to their host", /emiratespost\\\\\.ae/.test(block) || /emiratespost\\.ae/.test(block));
check("scoped by HOST, not by the integration's name", /entry\.spec\.baseUrl/.test(block));
check("writes only — POST, PUT, PATCH", /\^\(POST\|PUT\|PATCH\)\$/.test(block));
check("a read is not stamped just for being a read", !/GET/.test(block.split("A few of their reads")[0] ?? ""));

console.log("\nIt never overwrites, and never invents");
check("a source already on the payload wins", /if \(!already\)/.test(block));
check("either name and any casing counts as already set", /\/\^\(request\)\?source\$\/i\.test\(k\) && asStr\(body\[k\]\)/.test(block));
check("a query parameter is only set where the operation declares one", /entry\.op\.params \?\? \[\]\)\.find/.test(block));
check("...matched on a name ending in 'source'", /\/source\$\/i\.test/.test(block));
check("...and not overwritten either", /!asStr\(inp\[srcParam\.name\]\)/.test(block));

console.log("\nShapes that must not break it");
check("a body that is an array is left alone", /!Array\.isArray\(b\)/.test(block));
check("a missing body is left alone", /b && typeof b === "object"/.test(block));

console.log("\nIt does not disturb what was already there");
check("the renewal confirm keeps its own requestSource", /body\.requestSource = "PoBoxAIBot"/.test(src));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
