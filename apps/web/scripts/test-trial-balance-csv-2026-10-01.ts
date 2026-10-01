/**
 * A trial balance arrives as a CSV, and a CSV has to be READ (2026-10-01).
 *
 * "Trial balance will be in CSV so can we make it accept that and read it
 * accordingly on the renewal flow."
 *
 * Two halves, and the second is the one that would have gone unnoticed:
 * anything that was neither a PDF nor an image fell out of the extractor with
 * an empty result, which reads as success everywhere downstream. The file is
 * stored, the slot turns green, and nothing has looked at it.
 *
 * Run from apps/web:  npx tsx scripts/test-trial-balance-csv-2026-10-01.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const extract = readFileSync(new URL("../../../packages/core/src/ai/extract.ts", import.meta.url), "utf8");
const upload = readFileSync(new URL("../app/api/upload/route.ts", import.meta.url), "utf8");
const script = readFileSync(new URL("./epgl-trial-balance-csv-2026-10-01.ts", import.meta.url), "utf8");

console.log("\nA text file is read as text, not dropped");
check("csv, tsv and txt are known", /const TEXT_TYPES = new Set\(\["csv", "tsv", "txt"\]\);/.test(extract));
// A server can label a CSV text/plain, application/csv or nothing at all, so
// the extension is not the only signal.
check("...and so is any text content type", /input\.contentType\.startsWith\("text\/"\) \|\| input\.contentType === "application\/csv"/.test(extract));
check("...only then is a file given up on", /if \(!isPdf && !imageType && !isText\) return \{ values: \{\} \};/.test(extract));
check("...and it becomes a text block", /docBlock = \{\s*\n\s*type: "text",/.test(extract));
check("...carrying the file's own name and type", /The uploaded file is "\$\{input\.fileName\}"/.test(extract));

console.log("\nWith the two things a CSV does that a scan does not");
// Excel writes a BOM on every CSV it exports; left in, it becomes an invisible
// character on the first header.
check("the byte-order mark is stripped", extract.includes('.replace(/^\\uFEFF/, "")'));
check("a long file is cut", /text = text\.slice\(0, TEXT_LIMIT\)/.test(extract));
// A total that got truncated away must not read as a total that is missing.
check("...and the cut is declared to the reader", /has been cut off here\. Anything you cannot see is UNKNOWN, not absent/.test(extract));
check("...at a size that holds a trial balance", /const TEXT_LIMIT = 60_000;/.test(extract));

console.log("\nAnd the slot is gated on what the file turns out to be");
/**
 * "Trial balance" contains neither "financial" nor "statement", so the slot had
 * no type gate at all and any file whatsoever satisfied it — a passport dropped
 * into it would have gone green.
 */
check("a trial-balance slot has a type rule", /trial\.\?balance\|ميزان\.\?المراجعة/.test(upload));
check("...accepting the statement family", /return \["financial_statement", "audited_financial_statement"\];[\s\S]{0,120}if \(\/financial\|statement/.test(upload));

console.log("\nThe format is added to the slot by script, matched on label too");
check("csv is what it adds", /const FORMAT = "csv";/.test(script));
// The slot was added on 30 September from Emirates Post's feedback and its key
// is not guaranteed to be identical on both environments.
check("...matched by key or label", /const text = `\$\{d\.key\} \$\{Object\.values\(d\.label \?\? \{\}\)\.join\(" "\)\}`;/.test(script));
check("...idempotent", /\(already\) \$\{j\.key\}\/\$\{d\.key\}/.test(script));
// Finding nothing is not a quiet success: the point of the run is that this
// document accepts a CSV.
check("...and a slot it cannot find is an error", /No document slot here matches \$\{MATCH\} — nothing was changed/.test(script));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
