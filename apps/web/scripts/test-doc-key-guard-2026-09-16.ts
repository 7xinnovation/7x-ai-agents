/**
 * A field key is not a name the customer knows.
 *
 * A renewal on 16 September: "The system is still flagging `partner_1_passport`
 * and `partner_1_emirates_id` as missing — but as we agreed, GLOBAL JET EXPRESS
 * AE FZCO is a corporate partner and those don't apply." Two internal
 * identifiers read out to an applicant, in a sentence that also told them our
 * readiness calculation disagreed with the conversation.
 *
 * The danger in fixing it is the upload block: it addresses its slot as
 * `key: partner_1_passport`, with no backticks, and rewriting THAT would file
 * the document nowhere. So only a backticked key is touched.
 *
 * Run from apps/web:  npx tsx scripts/test-doc-key-guard-2026-09-16.ts
 */
import { docKeyGuard } from "../lib/docKeyGuard";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const LABELS: Record<string, string> = {
  partner_1_passport: "Partner 1 — passport copy",
  partner_1_emirates_id: "Partner 1 — Emirates ID",
  updated_trade_license: "Current trade / postal license",
};
const run = (text: string, chunk = 0) => {
  const g = docKeyGuard((k) => LABELS[k]);
  let out = "";
  if (chunk) for (let i = 0; i < text.length; i += chunk) out += g.push(text.slice(i, i + chunk));
  else for (const ch of text) out += g.push(ch);
  return out + g.flush();
};

const B = "```";

console.log("\nThe reported sentence");
{
  const said = "The system is still flagging `partner_1_passport` and `partner_1_emirates_id` as missing.";
  const out = run(said);
  check("the keys are gone", !/partner_1_passport|partner_1_emirates_id/.test(out), out);
  check("...replaced by what the customer was shown", out.includes("Partner 1 — passport copy") && out.includes("Partner 1 — Emirates ID"), out);
  check("...and the sentence still reads", out.startsWith("The system is still flagging ") && out.endsWith("as missing."), out);
}

console.log("\nAnd the block that addresses a slot BY key is untouched");
{
  const msg = `Please upload it here:\n\n${B}upload\nkey: partner_1_passport\n${B}\n`;
  check("the upload block survives exactly", run(msg) === msg, run(msg));
  const two = `${B}upload\nkey: updated_trade_license\nkey: partner_1_emirates_id\n${B}`;
  check("...including a block with two slots", run(two) === two);
}

console.log("\nEverything else is left alone");
for (const text of [
  "`code that is not a key`",
  "Here is some `inline code` in a sentence.",
  "`snake_case_but_unknown` stays as it was",
  "No backticks at all: partner_1_passport written bare is left for the upload block's sake",
  "A stray ` backtick that never closes",
  "```\njust a fence\n```",
]) check(JSON.stringify(text.slice(0, 44)), run(text) === text, run(text));

console.log("\nIt streams");
{
  const said = "Missing: `partner_1_passport` — that is all.";
  check("a character at a time", run(said, 1) === run(said, 1000), [run(said, 1), run(said, 1000)]);
  check("...and in odd chunks", run(said, 7) === run(said, 1000));
  check("...and the result is right either way", run(said, 3).includes("Partner 1 — passport copy"));
  // Nothing may be swallowed: every byte in must come out, changed or not.
  const kept = run("abc `xyz` def", 2);
  check("nothing is dropped", kept === "abc `xyz` def", kept);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
