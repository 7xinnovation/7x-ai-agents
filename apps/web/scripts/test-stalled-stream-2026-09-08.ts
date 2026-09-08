/**
 * A dead connection must not look like a chat that is still thinking.
 *
 * 8 September, staging: a rental reached Rental/Save, Emirates Post returned
 * order 260972927 and a payment URL, the reply carrying it was generated and
 * stored -- and the customer's screen showed "Creating your order now — one
 * moment. Working on it…" for five minutes. The connection had been dropped
 * without a FIN, so reader.read() never returned and nothing after it ran.
 *
 * Run from apps/web:  npx tsx scripts/test-stalled-stream-2026-09-08.ts
 */
export {};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const { readFileSync } = await import("node:fs");
const exp = readFileSync(new URL("../app/embed/[agent]/Experience.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");

console.log("\nThe client gives up on silence");
check("there is a stall timeout", /const STALL_MS = 45_000/.test(exp));
check("it is re-armed on every chunk", /armStall\(\);\s*buffer \+= decoder\.decode/.test(exp));
check("...and armed before the first read", /armStall\(\);\s*\n\s*for \(;;\)/.test(exp));
check("it cancels the reader rather than waiting", /reader\.cancel\(\)/.test(exp));
check("and clears the timer when the stream ends properly", /if \(timer\) clearTimeout\(timer\);/.test(exp));

console.log("\nAnd recovers what the server already finished");
check("a stall re-reads the conversation", /if \(stalled && convId\.current\)[\s\S]{0,200}?\/api\/conversations\//.test(exp));
check("it replaces the messages with the stored ones", /setMessages\(data\.messages\)/.test(exp));
check("...and the case with them", /if \(data\.case\) setCaseState\(data\.case\)/.test(exp));
check("only on a stall — a normal turn is untouched", /if \(stalled && convId\.current\)/.test(exp));
check("the spinner still clears either way", /finally \{\s*setStreaming\(false\);\s*setToolStatus\(null\);/.test(exp));

console.log("\nThe server was never the one hanging");
check("the stream closes BEFORE the deferred work drains", route.indexOf("controller.close()") < route.indexOf("for (const job of deferred)"));
check("a deferred failure is logged, not surfaced", /deferred_job_failed/.test(route));

console.log("\nAn escalation that cannot be arranged is a sentence, not a dead turn");
check("createCallback is caught", /createCallback\(actx[\s\S]{0,320}?\} catch \(e\) \{/.test(tools));
check("createCase is caught too", /createCase\(actx[\s\S]{0,300}?\} catch \(e\) \{/.test(tools));
check("no reference is invented for a request nobody got", /Do NOT give the customer a reference/.test(tools));
check("the customer is given a number they can call", /600 599 999/.test(tools));
check("...twice, once for each path", (tools.match(/600 599 999/g) ?? []).length >= 2);
check("what already succeeded is not described as failed", /must not be described as failed|do not suggest it failed/.test(tools));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
