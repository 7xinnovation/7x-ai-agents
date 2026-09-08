/**
 * Emirates Post asked to be able to tell our transactions from their website's.
 *
 * Their PO Box APIs carry a Source on the request and their own site sends
 * "Web". Their API team asked for a distinct value for the assistant, so a
 * rental or renewal made here can be identified in their reporting.
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
check("the value is ChatBot", /const REQUEST_SOURCE = process\.env\.NXN_REQUEST_SOURCE \|\| "ChatBot"/.test(src));
check("...and can be changed without a deploy", /process\.env\.NXN_REQUEST_SOURCE/.test(src));
check("it is written as Source on the body", /body\.Source = REQUEST_SOURCE/.test(block));

console.log("\nOnly Emirates Post, and only their transactions");
check("scoped to their host", /emiratespost\\\\\.ae/.test(block) || /emiratespost\\.ae/.test(block));
check("scoped by HOST, not by the integration's name", /entry\.spec\.baseUrl/.test(block));
check("writes only — POST, PUT, PATCH", /\^\(POST\|PUT\|PATCH\)\$/.test(block));
check("a read is not stamped just for being a read", !/GET/.test(block.split("A few of their reads")[0] ?? ""));

console.log("\nIt never overwrites, and never invents");
check("a Source already on the payload wins", /!asStr\(body\.Source\) && !asStr\(body\.source\)/.test(block));
check("either casing counts as already set", /body\.source/.test(block));
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
