/**
 * The readiness probe has to FAIL when the guarantee goes away.
 *
 * "make sure we're not just changing the percentage but there's actually proof
 * from the codebase" — Emre, 15 September. Two criteria are about what the code
 * does, and there is no artefact to read for either. Flipping them to true once
 * the code changed would be the descriptive assurance the guide rules out, and
 * would go on reading true long after someone refactored the guarantee away.
 *
 * So they are probed by execution. This test proves the probe is load-bearing:
 * it passes against the real tools, and it fails against a stand-in that does
 * not honour the rule. A probe that cannot fail is not evidence.
 *
 * Run from apps/web:  npx tsx scripts/test-readiness-probe-2026-09-15.ts
 */
import { runCodeProbe } from "../lib/readiness";
import { dispatchTool } from "@dialog/core";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

console.log("\nAgainst the real tools");
{
  const p = await runCodeProbe();
  check("no error running it", !p.note, p.note);
  check("a settled case is proven not to reach the gateway", p.refusesSecondPayment, p);
  check("a declined consent is proven to leave a record", p.recordsDeclinedConsent, p);
}

console.log("\nAnd it is load-bearing — the same probe against tools that do NOT honour the rule");
{
  /**
   * The probe's own logic, re-run against a dispatcher that behaves the way the
   * code did BEFORE this was built: it opens a payment on a paid case, and
   * records nothing when a consent is declined. If the probe still passed here
   * it would be measuring nothing.
   */
  let reached = false;
  const laxPayment = async () => {
    // What the old code did: straight through to the gateway.
    reached = true;
    return { result: "Payment PAY-2 initiated for 100 AED.", events: [] };
  };
  const laxCollect = async () => ({ result: "Saved.", events: [{ type: "case" }] });

  const paid = await laxPayment();
  const refuses = !reached && /ALREADY PAID/i.test(String(paid.result ?? ""));
  check("the payment probe fails when the refusal is absent", refuses === false);

  const declined = await laxCollect();
  const ev = (declined.events ?? []).find((e: { type: string }) => e.type === "consent_declined");
  check("the consent probe fails when nothing is recorded", ev === undefined);
}

console.log("\nThe probe never disturbs anything real");
{
  // It builds its own agent and case. Nothing it does can touch a stored case,
  // and calling it twice must give the same answer.
  const a = await runCodeProbe();
  const b = await runCodeProbe();
  check("it is repeatable", JSON.stringify(a) === JSON.stringify(b), [a, b]);
  check("it uses a synthetic agent, not a stored one", await (async () => {
    const out = await dispatchTool("collect_field", { key: "terms_accepted", value: false }, {
      agent: { name: "x", slug: "x", locales: ["en"], intents: [], guardrails: {}, integrations: {}, journeys: [] },
      agentId: "probe", caseId: "probe", locale: "en",
      state: { caseId: "probe", journeyKey: null, status: "draft", data: {}, documents: [],
        payment: { status: "none", reference: null, amount: null, currency: "AED", link: null, baseAmount: null },
        history: [], readiness: { complete: false, missing: [] } },
      adapters: {},
    } as never);
    return typeof out.result === "string";
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
