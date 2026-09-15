/**
 * Two readiness requirements, actually built rather than scored differently.
 *
 * The pre-launch gate had both as honest `ok: false`: the never-double-pay rule
 * was "upheld by model behaviour, not by code", and a declined consent left
 * nothing behind at all. The checks only moved because the capability did.
 *
 * Run from apps/web:  npx tsx scripts/test-readiness-wins-2026-09-15.ts
 */
import { dispatchTool } from "@dialog/core";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const AGENT = {
  name: "t", slug: "t", locales: ["en"], intents: [], guardrails: {},
  integrations: { payment: { provider: "stub", settings: {} } },
  journeys: [{
    key: "renewal", title: { en: "Renewal" }, intent: "renew",
    steps: [{ key: "s", title: { en: "s" }, documents: [], fields: [
      { key: "terms_accepted", type: "boolean", label: { en: "Terms" }, validation: { required: true } },
      { key: "marketing_consent", type: "boolean", label: { en: "Marketing" }, validation: { required: false } },
    ] }],
    submission: { amount: 100700, currency: "AED", requiresPayment: true, apiFlow: {} },
  }],
} as never;

const caseOf = (over: Record<string, unknown>) => ({
  caseId: "c1", journeyKey: "renewal", status: "draft",
  data: { terms_accepted: true }, documents: [],
  payment: { status: "none", reference: null, amount: null, currency: "AED", link: null, baseAmount: null },
  history: [], ...over,
}) as never;

function gateway() {
  const seen: { calls: number } = { calls: 0 };
  return { seen, adapter: { initiate: async () => { seen.calls++; return { status: "pending" as const, reference: "PAY-1", link: "https://pay/1" }; } } };
}
const run = (state: never, adapters: never, input: Record<string, unknown> = {}, name = "request_payment") =>
  dispatchTool(name, input, { agent: AGENT, agentId: "a1", caseId: "c1", locale: "en", state, adapters } as never);

console.log("\nA paid case cannot be charged twice");
{
  const g = gateway();
  const paid = caseOf({ payment: { status: "paid", reference: "NGE-882", amount: 100700, currency: "AED", link: null, baseAmount: 100700 } });
  const out = await run(paid, { payment: g.adapter } as never);
  check("the gateway is never called", g.seen.calls === 0, g.seen.calls);
  check("...and it is not reported as an error", !out.isError, out.isError);
  check("the reply says it is already paid", /ALREADY PAID/.test(out.result), out.result);
  check("...names the amount and the reference", /100700 AED/.test(out.result) && /NGE-882/.test(out.result), out.result);
  check("...forbids asking again", /Do NOT ask the customer to pay again/.test(out.result));
  check("...and points at the step that remains", /Call submit_case now/.test(out.result), out.result);
}
{
  // Already submitted as well: there is nothing to do but report it.
  const g = gateway();
  const done = caseOf({ status: "submitted", payment: { status: "paid", reference: "NGE-883", amount: 100700, currency: "AED", link: null, baseAmount: 100700 } });
  const out = await run(done, { payment: g.adapter } as never);
  check("a submitted, paid case is told so", /already submitted/.test(out.result), out.result);
  check("...and still never charged", g.seen.calls === 0);
}
{
  // The ordinary path is untouched.
  const g = gateway();
  const out = await run(caseOf({}), { payment: g.adapter } as never);
  check("an unpaid case still opens a payment", g.seen.calls === 1, out.result);
}

console.log("\nA refusal is an outcome, not an absence");
const declined = (out: { events?: { type: string }[] }) =>
  (out.events ?? []).find((e) => e.type === "consent_declined") as
    | { field: string; outcome: string; at: string; halted: string }
    | undefined;
{
  const out = await run(caseOf({ data: {} }), {} as never, { key: "terms_accepted", value: false }, "collect_field");
  const ev = declined(out);
  check("declining records an outcome", Boolean(ev), out.events);
  check("...as a refusal", ev?.outcome === "refused", ev);
  check("...naming the field", ev?.field === "terms_accepted");
  check("...with the moment it happened", Boolean(ev?.at && !Number.isNaN(Date.parse(ev.at))), ev?.at);
  check("...and what it stopped", /payment and submission/.test(ev?.halted ?? ""), ev?.halted);
}
{
  // Taking back something already granted is a WITHDRAWAL, which the artefact
  // records separately.
  const out = await run(caseOf({ data: { terms_accepted: true, terms_accepted_at: "2026-09-15T10:00:00.000Z" } }), {} as never, { key: "terms_accepted", value: false }, "collect_field");
  const ev = declined(out);
  check("withdrawing a granted consent is recorded as a withdrawal", ev?.outcome === "withdrawn", ev);
  check("...and the stale acceptance time is cleared with it",
    ((out.state as { data: Record<string, unknown> }).data.terms_accepted_at) === undefined);
}
{
  const out = await run(caseOf({ data: {} }), {} as never, { key: "marketing_consent", value: false }, "collect_field");
  check("an optional consent stops only its own step", /the step this acceptance belongs to/.test(declined(out)?.halted ?? ""), declined(out));
}
{
  const out = await run(caseOf({ data: {} }), {} as never, { key: "terms_accepted", value: true }, "collect_field");
  check("agreeing records no refusal", declined(out) === undefined);
  check("...and is still stamped", Boolean((out.state as { data: Record<string, unknown> }).data.terms_accepted_at));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
