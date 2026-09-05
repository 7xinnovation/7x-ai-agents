/**
 * A file already in the case is not asked for again.
 *
 * Run from apps/web:  npx tsx scripts/test-upload-guard-2026-09-05.ts
 */
import { collectedUploadGuard, replaceCollected } from "../lib/uploadGuard";

let pass = 0, fail = 0;
const eq = (name: string, got: string, want: string) => {
  if (got === want) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};
// Exactly the case from 5 Sep: trade_license uploaded, everything else pending.
const collected = (k: string) =>
  k === "trade_license"
    ? { label: "Trade License / Initial Approval", fileName: "Trade License Main 697670 - 2025 - 2026.pdf" }
    : null;
const run = (text: string, chunk = 1000) => {
  const g = collectedUploadGuard(collected);
  let out = "";
  for (let i = 0; i < text.length; i += chunk) out += g.push(text.slice(i, i + chunk));
  return out + g.flush();
};

const already = "_Already uploaded: **Trade License / Initial Approval** — Trade License Main 697670 - 2025 - 2026.pdf. Nothing to do here._";

eq("the block becomes an answer",
  run("Let's start with the Trade License.\n```upload\nkey: trade_license\n```\nThen we continue."),
  `Let's start with the Trade License.\n${already}\nThen we continue.`);
eq("a document still needed is still asked for",
  run("```upload\nkey: moa\n```"),
  "```upload\nkey: moa\n```");
eq("a mixed block is left alone rather than half-rewritten",
  run("```upload\nkey: trade_license\nkey: moa\n```"),
  "```upload\nkey: trade_license\nkey: moa\n```");
eq("both collected, both answered",
  run("```upload\nkey: trade_license\nkey: trade_license\n```"),
  `${already}\n${already}`);
eq("a block naming no key is untouched", run("```upload\n```"), "```upload\n```");
eq("other fences pass through", run("```cards\n- title: X\n```"), "```cards\n- title: X\n```");
eq("plain prose passes through", run("Nothing fenced here."), "Nothing fenced here.");
eq("an unclosed block survives", run("```upload\nkey: trade_license"), "```upload\nkey: trade_license");
for (const size of [1, 3, 9, 40]) {
  eq(`chunk ${size}`,
    run("Upload it:\n```upload\nkey: trade_license\n```\nok", size),
    `Upload it:\n${already}\nok`);
}
eq("no file name, still answered",
  replaceCollected("```upload\nkey: x\n```", () => ({ label: "Passport" })),
  "_Already uploaded: **Passport**. Nothing to do here._");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
