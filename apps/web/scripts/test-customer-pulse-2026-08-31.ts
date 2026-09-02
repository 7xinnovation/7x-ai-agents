/**
 * Customer Pulse, end to end against the sandbox (2026-08-31).
 *
 * It mints a real survey token on the government sandbox, which is what the flow
 * has to do -- the two-call shape is undocumented in the manual we were given
 * (still at v1) and was read off the live API, so a test that stubs it would be
 * testing my reading rather than their service.
 *
 * Run from apps/web:  npx tsx scripts/test-customer-pulse-2026-08-31.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { pulseSurveyToken, pulseServiceFor, pulseConfigured, pulseIsSandbox, toE164 } from "@/lib/customerPulse";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

const uuid = () => globalThis.crypto.randomUUID();

check("rental maps to its survey", pulseServiceFor("personal_po_box_rental") === "rent_personal");
check("corporate renewal maps to its survey", pulseServiceFor("corporate_po_box_renewal") === "renew_corporate");
check("an unrelated journey gets no survey", pulseServiceFor("manage_po_box") === null);
check("a new licence maps to its own survey", pulseServiceFor("new_license") === "license_new");
check("a licence renewal maps to its own", pulseServiceFor("renewal") === "license_renewal");
check("EPGL is not pointed at a PO Box survey",
  pulseServiceFor("new_license") !== pulseServiceFor("rent_personal") &&
    pulseServiceFor("renewal") !== pulseServiceFor("renew_personal"));

// The shapes a UAE mobile actually arrives in. Customer Pulse rejects the whole
// call on a bad one, so a number we cannot place is dropped instead.
check("a local mobile becomes E.164", toE164("0553708000") === "+971553708000");
check("spaces and dashes are ignored", toE164("055 370-8000") === "+971553708000");
check("a bare 9-digit mobile is placed", toE164("553708000") === "+971553708000");
check("00-prefixed international is converted", toE164("00971553708000") === "+971553708000");
check("an already-E.164 number is kept", toE164("+441632960961") === "+441632960961");
check("a landline-shaped number is dropped", toE164("042951111") === "");
check("words are dropped", toE164("call me") === "");
check("empty is empty", toE164(undefined) === "");
check("no journey gets no survey", pulseServiceFor(null) === null);

// EPGL's linking ids are its own; without them the survey stays off rather than
// running against a PO Box survey.
console.log(
  pulseConfigured("license_new")
    ? "EPGL licensing survey is configured"
    : "EPGL licensing survey is NOT configured — CUSTOMER_PULSE_ID_LICENSE_NEW / _RENEWAL are needed from Customer Pulse"
);

if (!pulseConfigured("rent_personal")) {
  console.log("\nCustomer Pulse is not configured in this environment — skipping the live calls.");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
check("the sandbox is recognised as such", pulseIsSandbox() === /sandbox/i.test(process.env.CUSTOMER_PULSE_API_BASE_URL ?? ""));

// A real token, for a transaction that looks like a rental.
const tx = `test-${uuid()}`;
const token = await pulseSurveyToken({
  service: "rent_personal",
  transactionId: tx,
  feesAed: 370,
  customer: { emiratesId: "784199983926421", name: "Test Customer", email: "test@example.com", mobile: "0553708000" },
});
check(`a token is minted (${token ?? "none"})`, typeof token === "string" && token.length > 20, token);

// The survey the customer would open must exist behind that token.
if (token) {
  const res = await fetch(`${process.env.CUSTOMER_PULSE_API_BASE_URL}/api/v2/survey/token/${token}/`, {
    headers: { "X-INTEGRATION-APIKEY": process.env.CUSTOMER_PULSE_API_KEY!, Accept: "application/json" },
  });
  check(`the token resolves to a survey (HTTP ${res.status})`, res.ok);
}

// A mobile number that is not E.164 must not fail the call -- it is dropped.
const t2 = await pulseSurveyToken({
  service: "renew_corporate",
  transactionId: `test-${uuid()}`,
  feesAed: null,
  customer: { emiratesId: "not-an-id", mobile: "call me", email: "x@example.com" },
});
check("a malformed identity still yields a token", typeof t2 === "string" && t2.length > 20, t2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
