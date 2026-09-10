/**
 * Every way a licence fee is confirmed tells Salesforce.
 *
 * It used to be one way. `notifyEpglIfLicenceFee` lived inside the payments
 * WEBHOOK route and was called from nowhere else -- and N-Genius does not call
 * that webhook, which the status route's own comment has said all along:
 *
 *   "A REAL gateway (N-Genius) does not call that webhook, so while the row is
 *    still 'initiated' we ask the gateway itself"
 *
 * So every card payment was confirmed by the browser's status poll, marked paid
 * on our side, and never mentioned to EPGL. LR-37324 is what that looks like
 * from the outside: submitted 07:39:46, paid by card 07:40:29, and still reading
 * "Under document review" with a lastUpdated of the submission -- the money ours,
 * the licence request untouched, and the payment advice unpaid forever.
 *
 * Three paths can learn a payment settled. All three must notify, and notifying
 * twice must be harmless, because they race.
 *
 * Run from apps/web:  npx tsx scripts/test-payment-notify-paths-2026-09-10.ts
 */
export {};

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};

const { readFileSync } = await import("node:fs");
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const lib = read("../lib/epglPayment.ts");
const webhook = read("../app/api/payments/webhook/route.ts");
const status = read("../app/api/payments/status/route.ts");
const reconcile = read("../app/api/payments/reconcile/route.ts");
const conversation = read("../lib/conversation.ts");

console.log("\nOne notifier, shared");
check("it lives in the library, not in a route", /export async function notifyEpglIfLicenceFee/.test(lib));
check("...and no route keeps a private copy",
  !/async function notifyEpglIfLicenceFee/.test(webhook) &&
  !/async function notifyEpglIfLicenceFee/.test(status) &&
  !/async function notifyEpglIfLicenceFee/.test(reconcile));
check("only EPGL is notified", /tenantSlug !== "epgl"/.test(lib));
check("nothing is sent before the licence request exists", /if \(!licenseRequestId\) return;/.test(lib));
check("it notifies against the Salesforce record id, not the LR- number", /c\?\.state\.reference/.test(lib));

console.log("\nAll three paths call it");
check("the gateway webhook", /await notifyEpglIfLicenceFee\(/.test(webhook));
check("the browser's status poll — the one that actually fires", /await notifyEpglIfLicenceFee\(/.test(status));
check("the reconcile sweep, as the backstop", /await notifyEpglIfLicenceFee\(/.test(reconcile));
check("the poll only notifies a payment that succeeded", /if \(status === "paid"\) \{\s*\n\s*await notifyEpglIfLicenceFee/.test(status));
check("the sweep likewise", /if \(status === "paid" && p\.conversationId\)/.test(reconcile));
check("the webhook likewise", /outcome === "paid" && pay\.agentId && pay\.conversationId/.test(webhook));

console.log("\nRacing is harmless");
check("it refuses to notify twice for one payment", /auditSeen\(conversationId, "epgl_payment_notified", reference\)/.test(lib));
check("auditSeen exists", /export async function auditSeen/.test(conversation));
// A reissued link or a retry after a decline is a DIFFERENT payment on the same
// conversation, and must still be notified.
check("...matched on the payment reference, not the conversation", /payload\} ->> 'reference' = \$\{reference\}/.test(conversation));

console.log("\nA Salesforce problem never breaks the payment");
check("every failure is swallowed", /catch \(e\) \{/.test(lib));
check("...and audited rather than lost", /epgl_payment_notify_failed/.test(lib));
check("the reason is recorded", /reason: e instanceof Error \? e\.message/.test(lib));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
