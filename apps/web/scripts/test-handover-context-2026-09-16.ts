/**
 * What goes with the customer when a person takes over.
 *
 * The context-transfer artefact asks that the request, its context and the
 * actions already taken move to the officer — "ينتقل الطلب والسياق والإجراءات
 * السابقة إلى الموظف". What moved was a name, a phone number and the customer's
 * own sentence; everything else was in our admin console, which the person
 * taking the callback does not open. The cost is paid by the customer, who
 * explains it again — and a re-explained journey loses the consents first.
 *
 * The PO asked back on 16 September (FB-1740) whether the chat log is enough.
 * This is the answer in code: the record the officer opens carries the journey.
 *
 * Run from apps/web:  npx tsx scripts/test-handover-context-2026-09-16.ts
 */
import { handoverContext, renderHandover } from "@dialog/core";
import { runCodeProbe } from "../lib/readiness";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const AGENT = {
  name: "EPGL", slug: "epgl", locales: ["en"], intents: [], guardrails: {}, integrations: {},
  journeys: [
    {
      key: "new_license",
      title: { en: "New postal activity licence" },
      intent: "new_license",
      steps: [
        { key: "contact", title: { en: "Your details" }, fields: [
          { key: "contact_name", label: { en: "Full name" }, type: "text", validation: { required: true } },
          { key: "contact_email", label: { en: "Email" }, type: "text", validation: { required: true } },
        ], documents: [] },
        { key: "docs", title: { en: "Documents" }, fields: [
          { key: "trade_license_number", label: { en: "Trade licence number" }, type: "text", validation: { required: true } },
        ], documents: [] },
        { key: "pay", title: { en: "Payment" }, fields: [
          { key: "declaration_accepted", label: { en: "Declaration" }, type: "boolean", validation: { required: true } },
        ], documents: [] },
      ],
    },
  ],
} as never;

const CASE = {
  journeyKey: "new_license",
  status: "draft",
  data: {
    contact_name: "Emre Karayalcin",
    contact_email: "emre.karayalcin@7x.ae",
    trade_license_number: "697670",
    declaration_accepted: true,
    declaration_accepted_at: "2026-09-16 08:05:57 UTC",
    __internal_thing: "should never travel",
  },
  documents: [
    { key: "trade_license", status: "uploaded", fileName: "TL 697670.pdf" },
    { key: "moa", status: "rejected", fileName: "old.pdf" },
  ],
  payment: { status: "paid", reference: "cbcd55cd", amount: 1000, currency: "AED" },
  referenceLabel: "LR-37385",
  reference: "a11FW000aHtco7sYQA",
} as never;

console.log("\nThe officer gets the journey, not a sentence");
{
  const c = handoverContext(AGENT, CASE);
  check("what they are trying to do", c.summary === "New postal activity licence", c.summary);
  check("where to pick it up", c.lastStep === "Payment", c.lastStep);
  check("what they have already paid", c.payment.startsWith("Paid AED 1000") && c.payment.includes("cbcd55cd"), c.payment);
  check("the reference the entity knows it by", c.caseReference === "LR-37385", c.caseReference);
  check("the consent, with the moment it was given", c.consents.some((x) => x.includes("2026-09-16 08:05:57")), c.consents);

  // THE POINT OF THE LIST: the officer must not ask for any of this again.
  check("everything already given is listed", c.doNotReAsk.includes("Full name") && c.doNotReAsk.includes("Trade licence number"), c.doNotReAsk);
  check("...including the documents on file", c.doNotReAsk.some((x) => x.includes("TL 697670.pdf")), c.doNotReAsk);
  check("a REJECTED document is not on the list", !c.doNotReAsk.some((x) => x.includes("old.pdf")), c.doNotReAsk);
  check("internal bookkeeping never travels", !JSON.stringify(c).includes("should never travel"), c.doNotReAsk);
  check("a consent is not listed as a thing to re-ask for", !c.doNotReAsk.some((x) => /declaration/i.test(x)), c.doNotReAsk);
  check("nothing is listed twice", new Set(c.doNotReAsk).size === c.doNotReAsk.length);
}

console.log("\nAnd it reads as a case note");
{
  const text = renderHandover(handoverContext(AGENT, CASE));
  check("it names the request", text.includes("Request: New postal activity licence"));
  check("it warns against re-asking, in words", /do not ask for these again/i.test(text), text);
  check("it states the payment", text.includes("Payment: Paid"));
}

console.log("\nAn empty case says so rather than inventing a journey");
{
  const c = handoverContext(AGENT, { journeyKey: null, status: "draft", data: {}, documents: [], payment: { status: "none" } } as never);
  check("no journey", c.summary === "No journey started", c.summary);
  check("nothing completed", c.lastStep === "Nothing completed yet", c.lastStep);
  check("nothing paid", c.payment === "Nothing paid", c.payment);
  check("nothing to re-ask for", c.doNotReAsk.length === 0);
}

console.log("\nIt actually reaches the adapter");
{
  // Not asserted anywhere: the readiness probe calls request_escalation against a
  // stub CRM and reads what the adapter was handed. If the context is ever
  // dropped from the call, this fails and the score falls with it.
  const probe = await runCodeProbe();
  check("the escalation tool hands the context to the CRM", probe.callbackCarriesContext, probe);
  const ops = readFileSync(new URL("../lib/registry.ts", import.meta.url), "utf8");
  check("the ops adapter puts it on the case it raises", /renderHandover\(input\.context\)/.test(ops));
  const sf = readFileSync(new URL("../../../packages/core/src/adapters/salesforce.ts", import.meta.url), "utf8");
  check("...and so does Salesforce", /renderHandover\(input\.context\)/.test(sf));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
