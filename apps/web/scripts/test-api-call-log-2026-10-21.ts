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
import { maskUrl, forStorage, maskSecrets, cursorAfter, PAGE_SIZE } from "../lib/apiCallLog";
import { readdirSync } from "node:fs";
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
check("no column exists to put a header in", !DDL.some((d) => /header/i.test(d)) && !/header/i.test(schema.slice(schema.indexOf('"api_calls"'), schema.indexOf('"api_calls"') + 2000)));
check("...and none is ever passed to the writer", !/headers:/.test(lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
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

console.log("\nEvery outbound call, not just the ones off a spec");
const LIB = new URL("../lib/", import.meta.url);
const COVERED: Record<string, string> = {
  "branchPlaces.ts": "Mapbox geocoding",
  "customerPulse.ts": "the survey service",
  "email.ts": "SendGrid / Resend / the webhook",
  "emxTracking.ts": "Emirates Post tracking",
  "epCase.ts": "the Emirates Post case endpoint",
  "epGeocode.ts": "reverse geocoding",
  "epglPayment.ts": "the EPGL payment notification",
  "epglRead.ts": "EPGL token and SOQL",
  "epInvoice.ts": "the invoice PDF",
  "epLogout.ts": "ending the Emirates Post session",
  "epRegions.ts": "the delivery regions",
  "epSavedCards.ts": "saved cards",
  "gatewayOrder.ts": "N-Genius",
  "gsbLookup.ts": "the GSB licence registry",
  "hostToken.ts": "host-token introspection",
  "integrations.ts": "every integration tool",
  "moeLicences.ts": "the MOE registry",
  "nxnAutoRenew.ts": "auto-renewal",
  "uaepass.ts": "UAE PASS",
};
for (const [file, what] of Object.entries(COVERED)) {
  check(`${what} is logged`, /trackedFetch/.test(readFileSync(new URL(file, LIB), "utf8")), file);
}
// A file that calls out and is NOT in the list above is one nobody decided
// about — which is how "all requests" quietly becomes "most requests".
const DELIBERATELY_OUT = new Set(["apiCallLog.ts", "health.ts", "outboundUrl.ts", "epglCallback.ts"]);
const callsOut = readdirSync(LIB)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => /\bfetch\(/.test(readFileSync(new URL(f, LIB), "utf8")));
const undecided = callsOut.filter((f) => !COVERED[f] && !DELIBERATELY_OUT.has(f));
check("no outbound library is left undecided", undecided.length === 0, undecided);
check("the EPGL callback case is logged by hand", /recordApiCall\(/.test(readFileSync(new URL("epglCallback.ts", LIB), "utf8")));
check("our own health probes are left out on purpose", !/trackedFetch/.test(readFileSync(new URL("health.ts", LIB), "utf8")));

console.log("\nA token request is not a file of credentials");
check("a form-encoded client_secret is masked", maskSecrets("grant_type=client_credentials&client_id=abc&client_secret=sh") === "grant_type=client_credentials&client_id=abc&client_secret=***", maskSecrets("grant_type=client_credentials&client_id=abc&client_secret=sh"));
check("...and the client id is kept, because that is the question", /client_id=abc/.test(maskSecrets("client_id=abc&client_secret=sh")));
check("a JSON secret is masked", /"clientSecret":"\*\*\*"/.test(maskSecrets(JSON.stringify({ clientId: "a", clientSecret: "b" }))));
check("...at any depth", /"apiKey":"\*\*\*"/.test(maskSecrets(JSON.stringify({ a: { b: { apiKey: "k" } } }))));
check("an access token in a body is masked", /"access_token":"\*\*\*"/.test(maskSecrets(JSON.stringify({ access_token: "t" }))));
check("ordinary prose is untouched", maskSecrets("HTTP 500 Internal Server Error") === "HTTP 500 Internal Server Error");
check("the stored body goes through it", /maskSecrets\(body\)/.test(lib));

console.log("\nThe wrapper hands the response back untouched");
check("the body is read off a clone", /res\.clone\(\)\.text\(\)/.test(lib));
check("...and a PDF is noted, not stored", /textual \? await res\.clone/.test(lib) && /`<\$\{type\}>`/.test(lib));
check("a thrown call is recorded and rethrown", /catch \(e\) \{[\s\S]{0,600}throw e;/.test(lib));

console.log("\nPaginated, so the page does not stretch");
check("a page is 50 rows", PAGE_SIZE === 50, PAGE_SIZE);
check("a short page is the last page", cursorAfter([{ createdAt: new Date() }]) === null);
check("a full page hands back the oldest row's time", cursorAfter(Array.from({ length: PAGE_SIZE }, (_, i) => ({ createdAt: new Date(1_700_000_000_000 + i) }))) === new Date(1_700_000_000_000 + PAGE_SIZE - 1).toISOString());
check("the list asks for one page", /limit: PAGE_SIZE/.test(page) && /limit: PAGE_SIZE/.test(route));
check("...keyed, not offset", /before: before && !Number\.isNaN/.test(route));
check("the page offers Newer and Older", /Newer/.test(client) && /Older/.test(client));
check("Newer is dead on the first page", /disabled=\{busy \|\| cursors\.length === 0\}/.test(client));
check("Older is dead at the end", /disabled=\{busy \|\| !data\.nextCursor\}/.test(client));
check("a filter change starts again at page one", /setCursors\(\[\]\);/.test(client));
check("auto-refresh follows the first page only", /setInterval\(\(\) => load\(\[\]\), 5000\)/.test(client));

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
check("auto-refresh is off until asked for", /const \[auto, setAuto\] = useState\(false\)/.test(client) && /setInterval\(/.test(client));

console.log("\nIt does not grow forever");
check("the sweep prunes it", /pruneApiCalls\(Number\(process\.env\.API_LOG_RETENTION_DAYS \?\? 30\)\)/.test(cron));
check("...and a failed prune does not fail the sweep", /pruneApiCalls\([\s\S]{0,80}?\)\.catch\(\(\) => 0\)/.test(cron));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
