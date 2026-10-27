/**
 * EPGL 2.0 takes the licence fee the way Salesforce actually raise it
 * (27 October 2026).
 *
 * The flow, from their 27 October answer and confirmed against the NewLaw
 * sandbox read-only the same morning:
 *
 *   1. composite: applicationId__c + Product_Code + EPG_Request_Status__c =
 *      "Pending Payment"   -> Salesforce raises the payment advice
 *   2. pricing again       -> refInvoiceId IS the advice number, items the amount
 *   3. our gateway         -> the money moves
 *   4. paymentNotification -> advice Paid, application SUBMITS ITSELF
 *
 * The failure this is written against is a quiet one. Their PaymentNotification
 * class marks `transactions[0]` of the licence request Paid; with step 1 skipped
 * there is no transaction, so the call answers 200 having changed nothing — the
 * applicant has paid and Emirates Post never hear about it. Nothing throws,
 * nothing logs, nothing shows red.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-2.0-payment-2026-10-27.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readyToPayBody,
  pricingBody,
  notifyBody,
  quoteFrom,
  compositeAccepted,
  compositeError,
  APPLICATION_ID,
  EPGL_ADVICE_KEY,
} from "../lib/epgl20Payment";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), "utf8");

// ---------------------------------------------------------------- step 1
{
  const b = readyToPayBody("LR-54066", "CEP30-UAE-SME-DOM") as {
    allOrNone: boolean;
    compositeRequest: { method: string; url: string; body: Record<string, unknown> }[];
  };
  const item = b.compositeRequest[0]!;
  check("one item, all or nothing", b.allOrNone === true && b.compositeRequest.length === 1);
  check("it is the licence request", item.url.endsWith("/EPG_License_Request__c") && item.method === "POST");
  check("keyed on the application id Salesforce issued", item.body.applicationId__c === "LR-54066");
  check("the status that raises the advice", item.body.EPG_Request_Status__c === "Pending Payment");
  // Without it NewRegulationApiAdapter.isNewLaw is false and CompositeHandler
  // takes the LEGACY branch, which sets "Under document review" by itself.
  check("the product code, which is what keeps it on the new-law path", item.body.Product_Code === "CEP30-UAE-SME-DOM");
  check("nothing else is sent on an update", Object.keys(item.body).length === 3, Object.keys(item.body));
}

// ---------------------------------------------------------------- step 2
{
  const b = pricingBody("LR-54066") as { quotationRequest: Record<string, unknown> };
  check("pricing still carries infos: [] — their Apex dereferences it",
    Array.isArray(b.quotationRequest.infos) && (b.quotationRequest.infos as unknown[]).length === 0);
  check("priced by application id", (b.quotationRequest.appIdentifier as { applicationId: string }).applicationId === "LR-54066");
  check("PayToSubmit, as their collection sends it", b.quotationRequest.payType === "PayToSubmit");
}

/** Their sandbox's own answer for LR-54066, still in Draft (27 Oct, verbatim shape). */
const DRAFT_QUOTE = JSON.stringify({
  status: 200,
  quotationResponse: {
    refInvoiceId: null,
    quotationStatus: "Approved",
    items: [{ totalAmount: 1000.0, amount: 1000.0, quantity: 1, currency: { en: "AED", ar: "درهم" } }],
    invoiceId: null,
    applicationId: "LR-54066",
  },
});
/** And for LR-54056, which they ran through payment themselves. */
const PAID_QUOTE = JSON.stringify({
  status: 200,
  quotationResponse: {
    refInvoiceId: "P14226",
    quotationStatus: "Paid",
    items: [{ totalAmount: 1000.0, amount: 1000.0, quantity: 1, currency: { en: "AED", ar: "درهم" } }],
    invoiceId: "a1IFW000wIDW4wG2QT",
    applicationId: "LR-54056",
  },
});

{
  const draft = quoteFrom(DRAFT_QUOTE)!;
  check("a Draft application has no advice yet", draft.adviceNumber === null);
  check("...and still quotes the real fee", draft.amount === 1000 && draft.currency === "AED");
  const paid = quoteFrom(PAID_QUOTE)!;
  check("refInvoiceId is the advice number", paid.adviceNumber === "P14226");
  check("quotationStatus says it is settled", /paid/i.test(paid.status ?? ""));
  check("a non-answer is null rather than a zero quote", quoteFrom("<html>502</html>") === null);

  // totalAmount is the LINE total; `amount` is the unit price. A licence priced
  // per site would be quoted short by summing the wrong one.
  const multi = JSON.stringify({
    quotationResponse: { refInvoiceId: "P1", items: [{ amount: 500, totalAmount: 1500, quantity: 3, currency: { en: "AED" } }] },
  });
  check("the line total is summed, not the unit price", quoteFrom(multi)!.amount === 1500);
}

// ---------------------------------------------------------------- step 4
{
  const b = notifyBody({
    applicationId: "LR-54066",
    adviceNumber: "P14231",
    amount: 1000,
    paymentId: "PAY-123",
    transactionId: "TXN-9",
    paidAt: new Date("2026-10-27T09:05:00.000Z"),
  }) as { notifyPayment: { applicationId: string; payment: Record<string, unknown>; infos: unknown[] } };
  const p = b.notifyPayment.payment as Record<string, unknown>;
  // Their class: WHERE applicationId__c = :payload.notifyPayment.applicationId.
  // 1.x keys on salesforceId; this org has no such field.
  check("keyed on the application id, not a Salesforce record id", b.notifyPayment.applicationId === "LR-54066");
  check("the advice number goes in both invoice fields", p.invoiceId === "P14231" && p.refInvoiceId === "P14231");
  check("paymentStatus is their enum's single value", p.paymentStatus === "Paid");
  const txns = p.transactions as Record<string, unknown>[];
  check("transactions is non-empty — they call isEmpty() on it with no null check", txns.length === 1);
  check("the amount rides on the transaction", txns[0]!.amount === 1000);
  // Their class rewrites "currency" -> "responseCurrency" on the raw JSON before
  // deserialising, because currency is reserved in Apex. 1.x sends the rewritten
  // spelling to a DIFFERENT org; sending it here would land in no field at all.
  check("currency is spelled plainly, as this org's class expects",
    JSON.stringify(txns[0]).includes('"currency"') && !JSON.stringify(txns[0]).includes("responseCurrency"));
  check("infos is present, as everywhere else on this contract", Array.isArray(b.notifyPayment.infos));
}

// ---------------------------------------------------------------- composites
{
  check("every item succeeding is acceptance",
    compositeAccepted(JSON.stringify({ compositeResponse: [{ body: { success: true } }] })));
  check("one failure is not", !compositeAccepted(JSON.stringify({ compositeResponse: [{ body: { success: true } }, { body: { success: false } }] })));
  check("an empty composite is not acceptance either", !compositeAccepted(JSON.stringify({ compositeResponse: [] })));
  check("their message is what gets reported",
    compositeError(JSON.stringify({ compositeResponse: [{ body: { errors: [{ message: "Unknown Product_Code" }] } }] })) === "Unknown Product_Code");
}

// ---------------------------------------------------------------- the ids
{
  check("LR- is the shape", APPLICATION_ID.test("LR-54066"));
  check("a Salesforce record id is not an application id", !APPLICATION_ID.test("a11FW000vNEtwxMYQR"));
  check("nor is an empty string", !APPLICATION_ID.test(""));
}

// ---------------------------------------------------------------- the wiring
{
  const tools = read("../../../packages/core/src/ai/tools.ts");
  const route = read("../app/api/chat/route.ts");
  const lib = read("../lib/epglPayment.ts");
  const orch = read("../../../packages/core/src/ai/orchestrator.ts");

  // The gate that would otherwise refuse every 2.0 payment there will ever be:
  // a composite-created application never sets state.reference.
  check("the submit-before-pay gate accepts an application id as well as a reference",
    /submitBeforePayment && !state\.reference && !\/\^LR-/.test(tools));
  check("the advice is raised BEFORE the amount is computed",
    tools.indexOf("ctx.readyToPay") < tools.indexOf("const overrideAmount"));
  check("a refusal says nothing was charged", /PAYMENT NOT READY:[\s\S]{0,200}NOTHING has been charged/.test(tools));
  check("an already-paid application is not charged twice", /ALREADY PAID: Emirates Post's records/.test(tools));
  check("the invoiced figure outranks every other price",
    /ready\?\.ok && ready\.amount > 0\s*\n\s*\? ready\.amount/.test(tools));
  check("it is plumbed through the orchestrator", /readyToPay: input\.readyToPay,/.test(orch));

  check("the route only ever runs it for EPGL", /readyToPay: async \(\) => \{[\s\S]{0,200}tenantSlug !== "epgl"/.test(route));
  check("...and only for an application Salesforce has numbered", /APPLICATION_ID\.test\(applicationId\)/.test(route));
  // Written by its constant, not its spelling: the key is shared with the
  // settlement path and the two must never drift apart by a typo.
  check("the advice number is written onto the case under the shared key",
    /\[EPGL_ADVICE_KEY\]: advice/.test(route) && /EPGL_ADVICE_KEY/.test(lib) && EPGL_ADVICE_KEY.startsWith("__epgl"));
  // A turn ends with one blind write of the whole case blob, built from the
  // state the engine loaded BEFORE the turn ran. An advice number written
  // mid-turn and not on that list is erased a second later — which is exactly
  // how LR-54052's application id was lost on 22 October.
  const conv = read("../lib/conversation.ts");
  const keys = /export const MID_TURN_DATA_KEYS = \[([\s\S]*?)\] as const;/.exec(conv)?.[1] ?? "";
  check("the advice number survives the end of the turn", keys.includes(`"${EPGL_ADVICE_KEY}"`), keys);
  check("both outcomes are audited", /epgl_payment_advice_failed/.test(route) && /action: "epgl_payment_advice"/.test(route));

  // One choke point for the settlement: webhook, status poll and reconcile
  // sweep all come through notifyEpglIfLicenceFee.
  check("settlement routes 2.0 away from the 1.x contract", /if \(APPLICATION_ID\.test\(applicationId\)\) \{\s*\n\s*await notifyNewRegulation/.test(lib));
  check("a missing advice is recorded as a failure, not swallowed",
    /no payment advice exists for this application, so there is nothing to mark paid/.test(lib));
  check("a lost advice number is re-read rather than given up on", /priceApplication\(agentId, env, applicationId\)/.test(lib));
  check("1.x still keys on the Salesforce record id", /salesforceId: input\.licenseRequestId\.trim\(\)/.test(lib));

  // The model must not be able to tell Emirates Post that money arrived. This
  // agent has invented API failures before, one of them a fake Apex stack
  // trace; a notification it can call is a payment it can report twice, or
  // report that never happened.
  // The model must not be able to tell Emirates Post that money arrived. This
  // agent has invented API failures before, one of them a fake Apex stack
  // trace; a notification it can call is a payment it can report twice, or
  // report that never happened.
  //
  // The filter is lifted out of the script's source and run here rather than
  // imported: that module calls main() — and process.exit — at the top level,
  // so importing it would end this run wherever it had got to.
  const integration = read("./epgl-2.0-integration-2026-10-20.ts");
  const m = /const NOT_AN_OPERATION = (\/.+\/);/.exec(integration);
  check("the script has a filter on what may become a tool", Boolean(m));
  const filter = new RegExp(m![1]!.slice(1, -1));
  check("paymentNotification is excluded by it", filter.test("/services/apexrest/paymentNotification"));
  check("...and so is the token endpoint", filter.test("/services/oauth2/token"));
  check("the pricing call is NOT excluded", !filter.test("/services/apexrest/payment/pricing"));
  check("...nor the composite", !filter.test("/services/apexrest/CompositeHandler"));
  // The exclusion is load-bearing only while their spec still publishes the path.
  check("their spec does publish it, so the exclusion is doing work",
    JSON.parse(read("./fixtures/EPG-Licensing-Pricing.openapi.json")).paths["/services/apexrest/paymentNotification"] !== undefined);
  check("...and the reason is written down", /must never be\s*\n \* reachable by a model/.test(integration));

  const guidance = read("./epgl-2.0-payment-2026-10-27.ts");
  check("the model is told to call request_payment and nothing else", /PAYING IS FOUR STEPS AND ONLY ONE OF THEM IS YOURS/.test(guidance));
  check("...and not to submit anything afterwards", /NOTHING IS SUBMITTED AFTER THE PAYMENT/.test(guidance));
  check("...and that the 1.x gateway surcharge is not this licence's", /THE ONLINE PAYMENT FEE NAMED FURTHER DOWN IS NOT THIS LICENCE'S/.test(guidance));
  check("a blocked payment is not described as a failed one", /That is not a failed payment and it is not the applicant's fault/.test(guidance));
}

// ------------------------------------------------- replacing the block
//
// The 20 and 21 October scripts kept only what followed the 2.0 block, which
// was right while that block was first in the text. It stopped being first on
// 22 October. This script inherited the line and took the values block — the
// product codes, the object names — out of the live guidance with it.
{
  const { replaceBlock } = await import("./epgl-2.0-payment-2026-10-27");
  const NEW = "NEW BLOCK (2026-10-27)";
  const OLDS = ["OLD BLOCK (2026-10-21)"] as const;
  const live = `VALUES BLOCK (2026-10-22) body\n\n---\n\nOLD BLOCK (2026-10-21) body\n\n---\n\n1.x text that renewals need`;

  const out = replaceBlock(live, "NEW BLOCK (2026-10-27) body", NEW, OLDS);
  check("what came BEFORE the old block survives", out.includes("VALUES BLOCK (2026-10-22) body"), out);
  check("the old block is gone", !out.includes("OLD BLOCK (2026-10-21)"), out);
  check("the new block is in", out.includes("NEW BLOCK (2026-10-27) body"));
  check("the 1.x text the renewals need survives", out.includes("1.x text that renewals need"));
  check("...and in that order",
    out.indexOf("VALUES BLOCK") < out.indexOf("NEW BLOCK") && out.indexOf("NEW BLOCK") < out.indexOf("1.x text"));

  check("running it twice changes nothing", replaceBlock(out, "NEW BLOCK (2026-10-27) body", NEW, OLDS) === out);
  const fresh = replaceBlock("just the 1.x text", "NEW body", NEW, OLDS);
  check("a text with no 2.0 block at all is prepended to, not replaced",
    fresh === "NEW body\n\n---\n\njust the 1.x text", fresh);
  // No separator after the old block: there is nothing of ours to keep, but
  // what came before it is still somebody's.
  const noSep = replaceBlock("VALUES\n\n---\n\nOLD BLOCK (2026-10-21) and nothing after", "NEW body", NEW, OLDS);
  check("a missing separator still keeps the prefix", noSep === "VALUES\n\n---\n\nNEW body", noSep);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
