/**
 * The addend actually reaches the gateway — the part that moves money.
 *
 * splitPenalties deciding 18,000 is owed is worth nothing if the card still
 * charges 100,700. This drives request_payment through the real tool with a
 * stub gateway and reads back what the payment adapter was handed.
 *
 * Run from apps/web:  npx tsx scripts/test-extra-charge-2026-09-15.ts
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
  journeys: [
    {
      key: "renewal",
      title: { en: "Renewal" },
      intent: "renew",
      steps: [{ key: "s", title: { en: "s" }, fields: [], documents: [] }],
      submission: { amount: 100700, currency: "AED", requiresPayment: true, apiFlow: {} },
    },
  ],
} as never;

function freshState() {
  return {
    caseId: "c1", journeyKey: "renewal", status: "in_progress",
    data: {}, documents: [], payment: { status: "none" }, history: [],
  } as never;
}

/** Captures what the gateway was asked to charge. */
function gateway() {
  const seen: { amount?: number } = {};
  return {
    seen,
    adapter: {
      initiate: async (_c: unknown, input: { amount: number }) => {
        seen.amount = input.amount;
        return { status: "pending" as const, reference: "PAY-1", link: "https://pay.example/1" };
      },
    },
  };
}

async function charge(extraCharge: { amount: number; label: string } | null) {
  const g = gateway();
  const out = await dispatchTool("request_payment", {}, {
    agent: AGENT,
    agentId: "a1",
    caseId: "c1",
    locale: "en",
    state: freshState(),
    adapters: { payment: g.adapter as never },
    extraCharge,
  } as never);
  return { amount: g.seen.amount, result: String(out.result ?? "") };
}

console.log("\nWithout penalties");
{
  const r = await charge(null);
  check("the licence fee alone is charged", r.amount === 100700, r.amount);
}

console.log("\nWith approved penalties");
{
  const r = await charge({ amount: 18000, label: "Form-9 Non Submission (Q1 2026)" });
  check("the penalty is added to the charge", r.amount === 118700, r.amount);
  check("...and named in the breakdown the agent reads", /Form-9 Non Submission \(Q1 2026\) 18000 AED/.test(r.result), r.result);
  check("...on top of the licence fee, stated", /on top of 100700 AED/.test(r.result), r.result);
}

console.log("\nMoney is not compounded across a reissued link");
{
  // The remembered base exists because a second payment on an unpaid case was
  // charging fee-on-fee. The addend must not reopen that hole.
  const g = gateway();
  const state = freshState() as unknown as Record<string, unknown>;
  (state.payment as Record<string, unknown>) = { status: "pending", baseAmount: 118700 };
  await dispatchTool("request_payment", {}, {
    agent: AGENT, agentId: "a1", caseId: "c1", locale: "en", state: state as never,
    adapters: { payment: g.adapter as never },
    extraCharge: { amount: 18000, label: "Approved penalties" },
  } as never);
  check("a remembered total is not topped up again", g.seen.amount === 118700, g.seen.amount);
}

console.log("\nA zero or absent addend changes nothing");
{
  check("zero", (await charge({ amount: 0, label: "x" })).amount === 100700);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
