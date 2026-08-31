/**
 * The pay block, guarded (2026-08-31).  npx tsx scripts/test-payfence-2026-08-31.ts
 */
import { payFenceGuard } from "@/lib/payFence";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

const REAL = "https://paypage.sandbox.ngenius-payments.com/v2?code=abc";
const OURS = "https://7xagents.7x-lab.com/api/payments/ext-return";

/** Feed text through the guard in awkward chunks, as the model streams it. */
function run(text: string, url: string | null, size = 3) {
  const g = payFenceGuard(() => url);
  let out = "";
  for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size));
  return out + g.flush();
}

const withBlock = (u: string) =>
  `Here is your summary.\n\nPlease pay now:\n\n\`\`\`pay\nurl: ${u}\namount: AED 765.00\n\`\`\`\n\nThe hold expires at 14:53.`;

// 1. The wrong URL is replaced by the one the backend issued.
{
  const out = run(withBlock(OURS), REAL);
  check("our return URL never reaches the customer", !out.includes(OURS), out);
  check("the backend's payment URL is substituted", out.includes(`url: ${REAL}`), out);
  check("the rest of the message is untouched", out.includes("The hold expires at 14:53.") && out.includes("Here is your summary."));
}

// 2. With no order there is nothing to pay for.
{
  const out = run(withBlock(REAL), null);
  check("no order -> no pay button", !out.includes("```pay"), out);
  check("no order -> the customer is told why", /order still has to be created/i.test(out), out);
  check("no order -> surrounding text survives", out.includes("The hold expires at 14:53."));
}

// 3. A correct block passes through byte for byte.
{
  const text = withBlock(REAL);
  check("a correct block is left exactly as written", run(text, REAL) === text);
}

// 4. Chunking must not change the answer.
{
  const text = withBlock(OURS);
  const sizes = [1, 2, 5, 7, 13, 64, 1000].map((n) => run(text, REAL, n));
  check("the result is the same at every chunk size", new Set(sizes).size === 1, sizes.map((s) => s.length));
}

// 5. Ordinary prose streams through, including backticks and near-misses.
{
  const prose = "Use the ``pay`` field, or a ```json fence — neither is a pay block.\nDone.";
  check("prose with backticks is unchanged", run(prose, REAL) === prose, run(prose, REAL));
  check("nothing is swallowed when the reply just ends", run("All set.", REAL) === "All set.");
  check("a trailing partial fence is still delivered", run("text ```pa", REAL) === "text ```pa");
}

// 6. A fence the model never closed is text, not a black hole.
{
  const out = run("Pay here:\n```pay\nurl: " + REAL, REAL);
  check("an unclosed fence is not lost", out.includes(REAL) && out.includes("Pay here:"), out);
}

// 7. A block with no url line gets one.
{
  const out = run("```pay\namount: AED 765.00\n```\n", REAL);
  check("a block missing its url is repaired", out.includes(`url: ${REAL}`), out);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
