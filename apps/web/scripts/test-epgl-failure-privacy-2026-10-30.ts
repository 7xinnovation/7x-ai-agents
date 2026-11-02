/**
 * The assistant explained Emirates Post's backend to an applicant (30 October).
 *
 *   "it requires a UAE PASS assurance level value to be passed with the
 *    application … assurance levels are set when you authenticate — they
 *    confirm the strength of the identity verification done at sign-in (basic,
 *    enhanced, etc.) … this is a configuration issue between this assistant and
 *    EPGL's backend"
 *
 * The call log says the first line was TRUE: Salesforce returned "Invalid value
 * was provided for \"UAE PASS Assurance Level\"", a missing Contact for the
 * signatory's UAE PASS id, and four lines of Apex stack trace. Everything after
 * it — where the value is set, what it measures, what the levels are called,
 * whose fault it was — is in no part of that body.
 *
 * That is the shape worth pinning. Not a fabricated error: a real one, dressed
 * in an explanation nobody gave, read out to the applicant along with the
 * mechanics. So these check both halves — that a failed call reaches the model
 * labelled, and that the label forbids the mechanics AND the embroidery.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-failure-privacy-2026-10-30.ts
 */
import { readFileSync } from "node:fs";
import { MARKER, RULE } from "./epgl-failure-privacy-2026-10-30";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : (extra ?? ""));
  ok ? pass++ : fail++;
};

const integrations = readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8");

console.log("\nA failed call arrives labelled");
check("there is a preface for failures", integrations.includes("const FAILURE_PREFACE ="));
check("...and a successful call does not carry it",
  /result: res\.ok \? `HTTP \$\{res\.status\}/.test(integrations), "the ok branch must stay unchanged");
check("...while a failed one does",
  /: `\$\{FAILURE_PREFACE\}\\nHTTP \$\{res\.status\}/.test(integrations));
/**
 * The host name in "getaddrinfo ENOTFOUND psql-…" is exactly the kind of thing
 * that used to reach the customer verbatim.
 */
check("a call that never completed is labelled too",
  /FAILURE_PREFACE\}\\nThe call did not complete/.test(integrations));
check("the body still reaches the model — it decides what to do with it",
  /\$\{trimmed\}`/.test(integrations));
check("and the full response is still logged for us", integrations.includes("raw: text"));

console.log("\nWhat the label forbids");
const preface = integrations.slice(integrations.indexOf("const FAILURE_PREFACE ="), integrations.indexOf("const FAILURE_PREFACE =") + 1800);
for (const [what, re] of [
  ["field and parameter names", /field, parameter or object names/],
  ["endpoints and tool names", /no endpoint or tool name/],
  ["status codes", /no status code/],
  ["stack traces", /no stack trace/],
  ["the word configuration", /configuration/],
  ["which system is at fault", /which system is at fault/],
  ["explaining what the body did not explain", /Do NOT explain anything this body does not actually state/],
  ["a recognised term being taken as a licence to expand", /A term you recognise is not permission to describe what it means/],
] as [string, RegExp][]) check(`it rules out ${what}`, re.test(preface), preface.slice(0, 200));
check("...but keeps what the customer genuinely needs", /says something about THEIR application that they could act on/.test(preface));
check("...and says what to do when there is nothing to pass on", /give them the reference/.test(preface));

console.log("\nThe journey rule says the same thing in the assistant's own voice");
check("the rule is dated and attributed", RULE.startsWith(MARKER));
for (const [what, re] of [
  ["the exact words that were used", /configuration issue between this assistant and EPGL's backend/],
  ["the sentence openers that give it away", /this is because.*these are set when/],
  ["writing from your own knowledge about their system", /your own knowledge about somebody else's system/],
  ["that the first line being true is what made it convincing", /It read as authoritative precisely because the first line was true/],
  ["the vocabulary that gives it away", /API, integration, configuration, token, session, endpoint, backend or payload/],
  ["what to say instead", /it could not be submitted, nothing they did is wrong/],
  ["the answer to the question actually asked", /What is the technical issue\?/],
  ["and that nothing is lost", /written to the call log in full/],
] as [string, RegExp][]) check(`the rule names ${what}`, re.test(RULE), RULE.slice(0, 120));
check("it does not tell them to say the fault is theirs", !/your (fault|mistake)/i.test(RULE));
check("the rule is one block, appended whole", RULE.split("\n\n").length >= 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
