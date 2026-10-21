/**
 * The admin's API Logs page, and the row behind every line of it.
 *
 * Asked for on 21 October: "an audit log of endpoints being called to show
 * which ones are successful and ones that are failing ... separate for both
 * agents." What these hold is the part that is easy to get wrong — that the
 * log cannot break a customer's call, and that it never writes down a
 * credential or an applicant's Emirates ID.
 *
 * Run from apps/web:  npx tsx scripts/test-api-call-log-2026-10-21.ts
 */
import { readFileSync } from "node:fs";
import { maskUrl, forStorage } from "../lib/apiCallLog";
import { DDL } from "./create-api-call-log-2026-10-21";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const schema = read("../../../packages/db/src/schema.ts");
const integrations = read("../lib/integrations.ts");
const lib = read("../lib/apiCallLog.ts");
const route = read("../app/api/admin/api-logs/route.ts");
const page = read("../app/admin/api-logs/page.tsx");
const client = read("../app/admin/api-logs/ApiLogsClient.tsx");
const nav = read("../app/admin/layout.tsx");
const cron = read("../app/api/payments/reconcile/route.ts");

console.log("\nOne row per outbound call, and the table to hold it");
check("the table is declared", /pgTable\(\s*\n?\s*"api_calls"/.test(schema));
check("...keyed for the per-agent view", /api_calls_agent_created_idx/.test(schema) && /api_calls_agent_ok_idx/.test(schema));
check("...and the DDL matches it", DDL.some((d) => /CREATE TABLE IF NOT EXISTS api_calls/.test(d)));
check("the DDL creates both indexes", DDL.filter((d) => /CREATE INDEX IF NOT EXISTS api_calls_/.test(d)).length === 2);
for (const col of ["agent_id", "conversation_id", "integration", "environment", "tool", "method", "path", "url", "status", "ok", "duration_ms", "error", "request_body", "response_body"]) {
  check(`${col} is in the DDL`, DDL.some((d) => new RegExp(`\\b${col}\\b`).test(d)));
}

console.log("\nIt is written where every integration call goes through");
check("executeOperation records it", /const record = \(outcome:/.test(integrations));
check("...with a clock started before the call", /const startedAt = Date\.now\(\);/.test(integrations));
check("...and the body read ONCE, before the 401 translations", integrations.indexOf("record({ status: res.status, ok: res.ok, responseBody: text });") < integrations.indexOf("Backend says auth is required/insufficient"));
check("a timeout is recorded too", /record\(\{ status: null, ok: false, error: aborted \? "timed out"/.test(integrations));
check("the agent, conversation and tool travel with it", /callLog: \{\s*\n\s*agentId,\s*\n\s*conversationId: opts\.conversationId,\s*\n\s*integration: entry\.integration,\s*\n\s*environment: activeEnv,\s*\n\s*tool: toolName,/.test(integrations));
check("...so the two agents can be told apart", /integration: intg\.name/.test(integrations));
check("the retry-without-saved-card call is logged as well", (integrations.match(/callLog: \{/g) ?? []).length === 2, (integrations.match(/callLog: \{/g) ?? []).length);
check("a caller that passes no context writes nothing", /if \(!opts\.callLog\) return;/.test(integrations));

console.log("\nA log never breaks a rental");
check("the insert is not awaited", /export function recordApiCall\(row: ApiCallRecord\): void \{\s*\n\s*void \(async \(\) => \{/.test(lib));
check("...and its failure is swallowed", /catch \(e\) \{[\s\S]{0,400}api_call_log_failed/.test(lib));

console.log("\nNo credentials, and no more personal data than the page needs");
check("a secret in the query string is masked", maskUrl("https://api.example.com/v1/thing?client_secret=hunter2&id=9") === "https://api.example.com/v1/thing?client_secret=***&id=9", maskUrl("https://api.example.com/v1/thing?client_secret=hunter2&id=9"));
check("...an access token too", /access_token=\*\*\*/.test(maskUrl("https://x.test/a?access_token=abc")));
check("...and an api key", /apiKey=\*\*\*/.test(maskUrl("https://x.test/a?apiKey=abc")));
check("an ordinary parameter is left alone", /boxNumber=36672/.test(maskUrl("https://x.test/a?boxNumber=36672")));
check("a URL we cannot parse is not mangled", maskUrl("not a url") === "not a url");
check("headers are never stored", !/headers\b/.test(lib.replace(/\/\*[\s\S]*?\*\//g, "")));
const body = JSON.stringify({ firstName: "Rama", email: "marmarika_88@hotmail.com", mobile: "0529498309", idNumber: "784-1988-1234567-1", boxNumber: "36672" });
const stored = forStorage(body) ?? "";
check("a name is redacted", !/Rama/.test(stored), stored);
check("an email is redacted", !/marmarika_88/.test(stored), stored);
check("an Emirates ID is redacted", !/1234567/.test(stored), stored);
check("the box number survives, because that is the bug you are chasing", /36672/.test(stored));
const forStorageSrc = /export function forStorage[\s\S]*?\n\}/.exec(lib)?.[0] ?? "";
check("redaction happens BEFORE truncation", forStorageSrc.indexOf("redactGuestPII(body)") < forStorageSrc.indexOf("MAX_BODY"), forStorageSrc);
check("a long body is cut", (forStorage("x".repeat(9000)) ?? "").length < 4100);
check("nothing is stored for an empty body", forStorage("") === null && forStorage(null) === null);

console.log("\nSeparate for both agents");
check("the page takes the admin's agent filter", /<AgentFilter agents=\{agentList\}/.test(page));
check("...and scopes the rows to it", /agentId: selected\?\.id/.test(page));
check("the refresh endpoint scopes the same way", /selectAgent\(agentList, url\.searchParams\.get\("agent"\)/.test(route));
check("...and cannot be widened past a restricted account", /const scope = await currentScope\(\)/.test(route));
check("it is in the admin navigation", /href: "\/admin\/api-logs", label: "API Logs"/.test(nav));

console.log("\nThe page answers the question it was asked");
check("successes and failures are split", /\["ok", `Success/.test(client) && /\["error", `Errors/.test(client));
check("failing endpoints are rolled up", /Endpoints with failures/.test(client) && /apiCallsByEndpoint/.test(page));
check("a row opens to the request and the response", /<h4>Request<\/h4>/.test(client) && /<h4>Response<\/h4>/.test(client));
check("...and says the bodies are redacted", /Personal data is redacted/.test(client));
check("the filters live in the URL", /router\.push\(`\/admin\/api-logs/.test(client));
check("auto-refresh is off until asked for", /useState\(false\)/.test(client) && /setInterval\(refresh, 5000\)/.test(client));

console.log("\nIt does not grow forever");
check("the sweep prunes it", /pruneApiCalls\(Number\(process\.env\.API_LOG_RETENTION_DAYS \?\? 30\)\)/.test(cron));
check("...and a failed prune does not fail the sweep", /pruneApiCalls\([\s\S]{0,80}?\)\.catch\(\(\) => 0\)/.test(cron));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
