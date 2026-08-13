/**
 * Regression test for "N-Genius create order failed: 422" (production, NXN,
 * 13 Aug 2026) — the payment failed at the very end of a completed PO Box
 * journey.
 *
 * The adapter sent `emailAddress: input.userRef`. userRef is an IDENTITY (a UAE
 * PASS sub), not an address, and the gateway rejects anything that is not a
 * well-formed email with 422 — so every signed-in customer's payment died at the
 * last step. The earlier manual check passed only because it happened to be
 * given a real address.
 *
 * Hits the real sandbox: creating an unpaid order is free and leaves nothing to
 * clean up.
 *
 *   NGENIUS_API_KEY=… npx tsx scripts/test-ngenius-order.ts
 */
import { ngeniusPayment } from "@dialog/core";

const OUTLET = "b78ef8c7-ce2a-41d6-84c9-e6219557a991";
const BASE = "https://api-gateway.sandbox.ngenius-payments.com";

const ctx = {
  agentSlug: "nxn-dialog",
  settings: { baseUrl: BASE, outletRef: OUTLET },
  secrets: { NGENIUS_API_KEY: process.env.NGENIUS_API_KEY },
} as never;

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

async function order(input: Record<string, unknown>) {
  return ngeniusPayment.initiate(ctx, {
    caseId: `test-${Math.floor(Date.now() / 1000)}`,
    amount: 325,
    currency: "AED",
    description: "PO Box rental",
    ...input,
  } as never);
}

async function main() {
  if (!process.env.NGENIUS_API_KEY) throw new Error("set NGENIUS_API_KEY");

  // The exact production shape: a signed-in customer, identity in userRef, and
  // an email collected in the case. Before the fix this threw 422.
  try {
    const r = await order({ userRef: "uaepass-mock-001", email: "customer@example.ae" });
    check("identity in userRef + a real email → order created", !!r.reference && !!r.link);
  } catch (e) {
    check("identity in userRef + a real email → order created", false, (e as Error).message.slice(0, 120));
  }

  // A guest who never gave an email must still be able to pay.
  try {
    const r = await order({ userRef: "uaepass-mock-001" });
    check("no email at all → order still created", !!r.reference);
  } catch (e) {
    check("no email at all → order still created", false, (e as Error).message.slice(0, 120));
  }

  // A malformed address must be dropped, not forwarded.
  try {
    const r = await order({ email: "not-an-email" });
    check("malformed email is dropped, not sent", !!r.reference);
  } catch (e) {
    check("malformed email is dropped, not sent", false, (e as Error).message.slice(0, 120));
  }

  // A failure must carry the gateway's reason, not just a status code.
  try {
    await ngeniusPayment.initiate(ctx, {
      caseId: "test-bad-amount", amount: -1, currency: "AED", description: "x",
    } as never);
    check("a rejected order surfaces the gateway's reason", false, "expected a rejection");
  } catch (e) {
    const m = (e as Error).message;
    check("a rejected order surfaces the gateway's reason", m.length > "N-Genius create order failed: 422".length, m.slice(0, 90));
  }

  console.log(fail ? `\n${fail} FAILED` : `\nAll ${pass} gateway checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {};
