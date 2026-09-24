/**
 * Do not report a payment against an advice that does not exist yet.
 *
 * PreProd2, 21 September. A new licence request is created, we notify forty
 * seconds later, Salesforce sets Payment Verified and two seconds after that
 * its workflow takes the request to Closed — past the review it was submitted
 * for. Field history on LR-37533, and the same on LR-37532 and LR-37534.
 *
 * The cause is not the amount and not the timing of a rollup. It is that there
 * is nothing to mark paid. Across six days of submissions the split is total:
 *
 *   S-EPG-000003 (renewal)       5 of 5 carry a payment advice, raised one
 *                                second after the request, for AED 100,000
 *   S-EPG-000002 (new licence)  13 of 13 carry none
 *
 * Which matches EPGL's own sequencing note: the advice is marked Paid "after
 * the request has been approved by the Business Team".
 *
 * Run from apps/web:  npx tsx scripts/test-notify-when-payable-2026-09-21.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const pay = read("../lib/epglPayment.ts");
const route = read("../app/api/chat/route.ts");
const recon = read("../app/api/payments/reconcile/route.ts");

console.log("\nAsking whether there is anything to mark paid");
check("there is a check", /export async function paymentAdviceExists/.test(pay));
check("it reads the payment advice object", /FROM EPG_Transaction__c WHERE EPG_License_Request__c/.test(pay));
check("the id is shape-checked before it is substituted", /if \(!SF_ID\.test\(id\)\) return null;/.test(pay));
check("an unanswerable question answers null, not false", /return null;/.test(pay));

/**
 * REVERSED ON 24 SEPTEMBER, deliberately.
 *
 * Holding the notification back stopped their workflow closing an unreviewed
 * application, and it bought the wrong thing: a request that had been PAID sat
 * at "Under document review" for ever, because Salesforce was never told the
 * money arrived. The status the applicant needs is Payment Verified, and the
 * notification is what produces it.
 *
 * The premature close is EPGL's own Payment Verified -> Closed automation. That
 * is theirs to gate on a review; withholding a true fact from their system of
 * record was never our way to gate it. A payment nobody can reconcile is worse
 * than a status that moves too fast.
 *
 * The advice is still READ — it is the difference between marking an invoice
 * paid and reporting a payment against nothing — and recorded on the audit.
 */
console.log("\nBoth paths notify, and record what they found");
check("the webhook / sweep path still asks", /const advice = await paymentAdviceExists\(agent\.id, env, licenseRequestId\)/.test(pay));
check("the at-submit path still asks", /const advice = await paymentAdviceExists\(agent\.id, env, reference\)/.test(route));
for (const [what, src] of [["the first", pay], ["the second", route]] as const) {
  check(`${what} no longer holds off`, !/epgl_payment_notify_deferred/.test(src));
  check(`${what} records whether there was an advice`, /adviceExisted: advice/.test(src));
}

console.log("\nDeferring is only safe if something asks again");
check("a deferral does NOT write the notified audit", !/epgl_payment_notify_deferred[\s\S]{0,400}epgl_payment_notified/.test(pay));
check("the sweep picks up paid fees with no notification", /EPGL licence fees that have been paid and still not reported/.test(recon));
check("...found by the absence of that audit row", /a\.action = 'epgl_payment_notified'/.test(recon));
check("...because the existing sweep cannot see them", /it looks at payments still "initiated", and these\s+\*\s+are paid/.test(recon));
check("...and it retries through the idempotent notifier", /await notifyEpglIfLicenceFee\(p\.agentId, p\.conversationId, p\.reference/.test(recon));
check("it is bounded rather than retried forever", /unreportedCut/.test(recon) && /7 \* 24 \* 60 \* 60_000/.test(recon));

console.log("\nThe evidence is recorded where the code is");
const prose = pay.replace(/\n\s*\*\s?/g, " ");
check("the split between renewal and new licence", /5 of 5 carry an advice/.test(prose) && /13 of 13 carry NONE/.test(prose));
check("...and their own sequencing note", /after the request has been approved by the Business Team/.test(prose));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
