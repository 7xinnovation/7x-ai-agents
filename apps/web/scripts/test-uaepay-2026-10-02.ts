/**
 * UAEPay: a second gateway, chosen by the customer (2026-10-02).
 *
 * EPGL offers three ways to pay — card, Virtual IBAN, UAEPay. Two of those are
 * gateways, and until now an agent had exactly one, bound at configuration
 * time. So the work is in two halves: letting a payment pick its own gateway,
 * and the UAEPay adapter itself.
 *
 * THE ADAPTER IS WRITTEN AGAINST THEIR UAT, NOT AGAINST THEIR GUIDE. Four
 * things found by calling it on 2 October, each of which would have failed
 * every payment:
 *
 *   1. emiratesId must be BARE DIGITS — their own documented example,
 *      "784-1993-1234566", is rejected with INVALID_EMIRATESID;
 *   2. merchantCode is required on every transactions[] line, not just at top;
 *   3. two lines with the same merchantCode -> DUPLICATE_MERCHANT, so the
 *      fee/surcharge split needs child merchant codes we do not have;
 *   4. business failures come back HTTP 200 with statusInfo SUCCESS and the
 *      real error inside paymentLinksInfo[].error.
 *
 * Run from apps/web:  npx tsx scripts/test-uaepay-2026-10-02.ts
 */
import { readFileSync } from "node:fs";
import { uaePayEmiratesId, uaePayMobile, uaePayPayment } from "@dialog/core";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const adapter = readFileSync(new URL("../../../packages/core/src/adapters/uaepay.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../../../packages/core/src/adapters/registry.ts", import.meta.url), "utf8");
const tools = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");

console.log("\nThe Emirates ID is sent the one way they accept");
check("dashes are stripped", uaePayEmiratesId("784-1999-8392642-1") === "784199983926421");
check("spaces too", uaePayEmiratesId(" 784 1999 8392642 1 ") === "784199983926421");
check("already bare stays bare", uaePayEmiratesId("784199983926421") === "784199983926421");
// 15 digits or nothing: a short one is not an Emirates ID, and sending it gets
// INVALID_EMIRATESID at the end of a conversation rather than here.
check("14 digits is not one", uaePayEmiratesId("784-1993-1234566") === undefined);
check("empty is nothing", uaePayEmiratesId("") === undefined && uaePayEmiratesId(undefined) === undefined);

console.log("\nAnd the mobile as a UAE number, not a local one");
check("0553708434 becomes 971553708434", uaePayMobile("0553708434") === "971553708434");
check("+971 55 370 8434 keeps its country code", uaePayMobile("+971 55 370 8434") === "971553708434");
check("00971… loses the trunk prefix", uaePayMobile("00971553708434") === "971553708434");
check("a bare nine-digit number gains one", uaePayMobile("553708434") === "971553708434");
check("nothing in, nothing out", uaePayMobile("") === undefined);

console.log("\nA payment with no Emirates ID is refused HERE");
{
  /**
   * Their error names the field and not the reason, and "invalid" on a number
   * nobody mistyped is a long afternoon. UAEPay is offered to signed-in
   * customers only, so an absent Emirates ID means the offer was made where it
   * should not have been — which is worth failing loudly over.
   */
  const ctx = {
    agentSlug: "t", settings: { merchantCode: "MR1" },
    secrets: { UAEPAY_CLIENT_ID: "x", UAEPAY_CLIENT_SECRET: "y" },
  };
  let refused = "";
  await uaePayPayment
    .initiate(ctx as never, { caseId: "c", amount: 10, currency: "AED", description: "d" })
    .catch((e: Error) => { refused = e.message; });
  check("refused before any network call", /Emirates ID/.test(refused), refused);
}

console.log("\nWhat the UAT taught us is in the code, not in a memory");
check("one transaction line, with its own merchantCode", /merchantCode: cfg\.merchantCode,\s*\n\s*transactionRemarks/.test(adapter));
check("...and why there is only one", /DUPLICATE_MERCHANT/.test(adapter));
check("a 200 with an error inside is still a failure", /const err = link0\?\.error \?\? body\?\.statusInfo\?\.error;/.test(adapter));
check("...and no link means no payment", /!link0\?\.paymentUrl/.test(adapter));
// 299 seconds is shorter than the gap between taking a payment and asking
// about it, so there is no window where caching is both safe and worth it.
check("the token is minted per call", /async function accessToken/.test(adapter) && !/let cached|tokenCache/.test(adapter));
check("the reference is the per-attempt UUID", /const merchantRequestId = crypto\.randomUUID\(\);/.test(adapter));
check("...which is what the inquiry is addressed by", /\/v2\/inquiry\/merchant\/\$\{encodeURIComponent\(cfg\.merchantCode\)\}\/txn\/\$\{encodeURIComponent\(input\.reference\)\}/.test(adapter));
// A payment we cannot read is not a payment that failed.
check("an unreadable status leaves it open", /if \(!res\.ok\) return \{ status: "initiated" \};/.test(adapter));
check("...and only SUCCESS is paid", /if \(status === "SUCCESS"\) return \{ status: "paid" \};/.test(adapter));

console.log("\nThe gateway is chosen by the customer's own choice");
check("resolved per payment method", /bundle\.paymentFor = \(method\) =>/.test(registry));
check("...falling back to the agent's one gateway", /if \(!bundle\.payment\) return undefined;/.test(registry));
check("...so an agent with one is unaffected", /method: key \|\| "default"/.test(registry));
check("request_payment reads payment_method", /state\.data as Record<string, unknown>\)\?\.payment_method/.test(tools));
// A context built from the default binding while talking to another gateway is
// the exact mismatch this is meant to prevent.
check("...and the binding travels with the adapter", /const actx = adapterContext\(agent, pay\.binding\);/.test(tools));
check("...the payer's details go with it", /customer: payerDetails\(state\)/.test(tools));
check("...read from the verified sign-in first", /"__verified_emirates_id", "emirates_id"/.test(tools));

console.log("\nAnd the payment row remembers which gateway holds the money");
const schema = readFileSync(new URL("../../../packages/db/src/schema.ts", import.meta.url), "utf8");
const caseSchema = readFileSync(new URL("../../../packages/config/src/case.ts", import.meta.url), "utf8");
check("a provider column", /provider: text\("provider"\),/.test(schema));
check("...and on the case too", /provider: z\.string\(\)\.nullable\(\)\.default\(null\),/.test(caseSchema));
const gw = readFileSync(new URL("../lib/paymentGateway.ts", import.meta.url), "utf8");
check("one resolver for the three probes", /export function gatewayForPayment/.test(gw));
check("...null means the agent's default, as it was", /Either no provider was recorded, or it is the agent's default one/.test(gw));
for (const route of ["status", "return", "reconcile"]) {
  const src = readFileSync(new URL(`../app/api/payments/${route}/route.ts`, import.meta.url), "utf8");
  check(`  /payments/${route} asks the gateway that took it`, /gatewayForPayment\(agent\.definition, (pay|p)\.provider\)/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
