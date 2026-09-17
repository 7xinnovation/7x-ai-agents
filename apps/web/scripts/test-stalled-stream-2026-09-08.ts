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
// 17 September: the same recovery now serves a SECOND door. A fetch that dies
// on a phone changing cell threw "Load failed" into the conversation verbatim,
// in English — WebKit's words, printed at a customer — when the turn it was
// carrying had already finished on the server. Both paths go through
// recoverTurn, and only a genuine nothing-to-show reaches noteDropped.
check("there is one recovery, shared", /const recoverTurn = async \(\): Promise<boolean>/.test(exp));
check("it re-reads the conversation", /recoverTurn[\s\S]{0,400}?\/api\/conversations\//.test(exp));
check("it replaces the messages with the stored ones", /setMessages\(stored\)/.test(exp));
check("...and the case with them", /if \(data\.case\) setCaseState\(data\.case\)/.test(exp));
check("a stall uses it", /if \(stalled && !\(await recoverTurn\(\)\)\) noteDropped\(\)/.test(exp));
check("...and so does a dropped fetch", /if \(!\(await recoverTurn\(\)\)\) noteDropped\(\)/.test(exp));
check("only then is the customer told, in their language", /noteDropped[\s\S]{0,600}?locale === "ar"/.test(exp));
check("and WebKit's own wording never reaches them", !/err instanceof Error \? err\.message/.test(exp));
check("the spinner still clears either way", /finally \{\s*abortRef\.current = null;\s*setStreaming\(false\);\s*setToolEvent\(null\);/.test(exp));

console.log("\nThe server was never the one hanging");
check("the stream closes BEFORE the deferred work drains", route.indexOf("controller.close()") < route.indexOf("for (const job of deferred)"));
check("a deferred failure is logged, not surfaced", /deferred_job_failed/.test(route));

console.log("\nAn escalation that cannot be arranged is a sentence, not a dead turn");
check("createCallback is caught", /createCallback\(actx[\s\S]{0,900}?\} catch \(e\) \{/.test(tools));
check("createCase is caught too", /createCase\(actx[\s\S]{0,300}?\} catch \(e\) \{/.test(tools));
check("no reference is invented for a request nobody got", /Do NOT give the customer a reference/.test(tools));
// The number itself moved into supportRoute() so a tenant without one is not
// handed Emirates Post's switchboard. What both paths must still do is give the
// customer somewhere to go.
check("the customer is given a number they can call", /600 599 999/.test(tools));
check("...on both paths", (tools.match(/\$\{supportRoute\(agent\)\}/g) ?? []).length >= 2);
check("what already succeeded is not described as failed", /must not be described as failed|do not suggest it failed/.test(tools));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
