/**
 * The body we send UAEPay, pinned (3 November 2026).
 *
 * Lifted out of `initiate` so it can be shown to them. Four of its properties
 * were each a failed payment before they were learned, and a refactor that
 * quietly dropped one would cost another: bare-digit Emirates ID, merchantCode
 * on the transaction line as well as the envelope, exactly ONE line, and
 * enableSecureRedirect true.
 *
 * Run from apps/web:  npx tsx scripts/test-uaepay-payload-2026-11-03.ts
 */
import { readFileSync } from "node:fs";
import { createLinksBody, uaePayEmiratesId, uaePayMobile } from "@dialog/core";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

const CFG = { merchantCode: "MR123093", returnUrl: "https://7xagents.7x-lab.com/api/payments/return" };
const INPUT = {
  caseId: "866988d4-d206-4689-b1f4-9080c3dd5a03",
  amount: 1000,
  description: "new_license",
  email: "someone@example.ae",
  locale: "en",
  customer: { name: "MOHAMMED MOUSA ABDULATIF ALI", mobile: "00971553708434" },
};
const REF = "2a533ad6-8bf6-445d-bbac-7d593901a7b1";
const body = createLinksBody(CFG, INPUT, REF, "784198162421055") as any;
const link = body.paymentLinksInfo[0];
const txn = link.transactions[0];

console.log("\nthe envelope");
check("serviceType is CREATE_LINK", body.serviceType === "CREATE_LINK");
check("source is UAEPAY", body.source === "UAEPAY");
check("the merchant code is on it", body.merchantCode === "MR123093");

console.log("\nthe four properties that were each a failed payment");
check("1 · the Emirates ID is bare digits", /^\d{15}$/.test(body.paymentInitiator.emiratesId), body.paymentInitiator.emiratesId);
check("2 · merchantCode is on the transaction line too", txn.merchantCode === "MR123093", txn);
check("3 · there is exactly ONE transaction line", link.transactions.length === 1, link.transactions.length);
check("4 · enableSecureRedirect is true", link.enableSecureRedirect === true);

console.log("\nthe identifiers");
check("merchantRequestId is the payment reference", link.merchantRequestId === REF);
check("merchantOrderId is the case, not the attempt", link.merchantOrderId === INPUT.caseId);
check("...and so is merchantReferenceId on the line", txn.merchantReferenceId === INPUT.caseId);
check("the two are NOT the same value", link.merchantRequestId !== link.merchantOrderId);
check("the landing URL is ours", link.merchantLandingURL === CFG.returnUrl);

console.log("\nthe money");
check("the amount is on the link", link.amount === 1000);
check("...and on the line", txn.transactionAmount === 1000);
check("fils are kept, not floated away", (createLinksBody(CFG, { ...INPUT, amount: 1000.456 }, REF, "784198162421055") as any).paymentLinksInfo[0].amount === 1000.46);

console.log("\nthe payer");
check("the mobile is normalised for them", body.paymentInitiator.mobileNumber === "971553708434", body.paymentInitiator.mobileNumber);
check("the name goes as given", body.paymentInitiator.name === INPUT.customer.name);
check("an absent name is omitted, not empty",
  (createLinksBody(CFG, { ...INPUT, customer: { mobile: "0501234567" } }, REF, "784198162421055") as any).paymentInitiator.name === undefined);
check("a local mobile gets the country code", uaePayMobile("0501234567") === "971501234567");
check("the language follows the conversation",
  (createLinksBody(CFG, { ...INPUT, locale: "ar" }, REF, "784198162421055") as any).paymentInitiator.language === "ar");
check("anything else is English", body.paymentInitiator.language === "en");

console.log("\nthe remarks, which have a length limit");
const longDesc = "x".repeat(300);
const long = createLinksBody(CFG, { ...INPUT, description: longDesc }, REF, "784198162421055") as any;
check("paymentRemarks is cut to 120", long.paymentLinksInfo[0].paymentRemarks.length === 120);
check("transactionRemarks too", long.paymentLinksInfo[0].transactions[0].transactionRemarks.length === 120);
check("the service name is cut to 80", long.paymentLinksInfo[0].metaData.serviceName.length === 80);

console.log("\nthe Emirates ID normaliser, which is what refuses a payment early");
check("their own guide's worked example is refused", uaePayEmiratesId("784-1993-1234566") === undefined);
check("...but the same number with the dashes out is taken", uaePayEmiratesId("784-1993-1234566-1") === "784199312345661");
check("fifteen digits pass", uaePayEmiratesId("784198162421055") === "784198162421055");
check("fourteen do not", uaePayEmiratesId("78419816242105") === undefined);
check("nothing at all does not", uaePayEmiratesId(undefined) === undefined);

console.log("\na failed ATTEMPT is not a failed payment");
const adapter = readFileSync(new URL("../../../packages/core/src/adapters/uaepay.ts", import.meta.url), "utf8");
check("FAILURE ends the payment only when the caller says it is the last word",
  /if \(status === "FAILURE"\) return \{ status: input\.final \? "failed" : "initiated", detail \};/.test(adapter));
check("...and SUCCESS is read before it, so a paid payment is never reopened",
  adapter.indexOf('status === "SUCCESS"') < adapter.indexOf('status === "FAILURE"'));
check("the reason still reaches the log either way", /"failed" : "initiated", detail \}/.test(adapter));
check("the evidence is written down, not just the rule",
  /S2PXT1911223218145/.test(adapter) && /LR-54113/.test(adapter));

console.log("\nnothing secret rides in the body");
const asText = JSON.stringify(body);
check("no client id, no secret, no token", !/client|secret|bearer|authorization/i.test(asText));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
