/**
 * The 1% admin processing fee (2026-09-03).
 *
 * EPGL confirmed: the fee is ON TOP. A 100,000 licence fee is charged as
 * 101,000, not 100,000 with 1,000 carved out of it. It applies only when the
 * customer pays through the gateway -- the VIBAN route, where Finance requests a
 * virtual IBAN from the bank by hand, is at face value.
 *
 * A percentage cannot be a surcharge: those are fixed amounts, and this scales
 * with a fee that comes from Salesforce.
 *
 * The trap it shares with the courier fee (test-payment-amount.ts) is reissued
 * payment links. The model passes back whatever it last quoted, so a fee applied
 * to a figure that already contains it compounds: 100,000 -> 101,000 -> 102,010.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-processing-fee-2026-09-03.ts
 */
import { processingFeeFor } from "@dialog/core";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};
const eq = (l: string, got: number, want: number) => check(`${l} → ${got}`, got === want, `expected ${want}`);

const GATEWAY = {
  requiresPayment: true,
  currency: "AED",
  surcharges: [],
  processingFee: {
    key: "admin_processing_fee",
    label: { en: "Admin processing fees", ar: "رسوم المعالجة الإدارية" },
    percent: 1,
    when: "payment_method == 'gateway'",
  },
} as never;

const ALWAYS = {
  requiresPayment: true,
  currency: "AED",
  surcharges: [],
  processingFee: { key: "admin_processing_fee", label: { en: "Admin processing fees", ar: "" }, percent: 1 },
} as never;

const NO_FEE = { requiresPayment: true, currency: "AED", surcharges: [] } as never;

const VIA_GATEWAY = { payment_method: "gateway" };
const VIA_VIBAN = { payment_method: "viban" };

// 1. The number EPGL gave us, exactly.
{
  eq("100,000 at 1% is a 1,000 fee", processingFeeFor(GATEWAY, VIA_GATEWAY, 100_000).amount, 1_000);
  const f = processingFeeFor(GATEWAY, VIA_GATEWAY, 100_000);
  eq("...so the customer is charged 101,000", 100_000 + f.amount, 101_000);
  check("...and it is labelled as they asked", f.label?.en === "Admin processing fees", f.label);
}

// 2. On top, never carved out. The failure this rules out is charging 100,000
//    and remitting 99,000 -- the licence fee would be short.
{
  const f = processingFeeFor(GATEWAY, VIA_GATEWAY, 5_000);
  eq("the base is untouched", 5_000, 5_000);
  eq("the fee is added to it", 5_000 + f.amount, 5_050);
}

// 3. Gateway only. The VIBAN route is face value.
{
  eq("no fee on the VIBAN route", processingFeeFor(GATEWAY, VIA_VIBAN, 100_000).amount, 0);
  eq("no fee before a method is chosen", processingFeeFor(GATEWAY, {}, 100_000).amount, 0);
  eq("an unconditional fee still applies", processingFeeFor(ALWAYS, {}, 100_000).amount, 1_000);
  eq("a journey declaring none charges none", processingFeeFor(NO_FEE, VIA_GATEWAY, 100_000).amount, 0);
}

// 4. Rounded to fils. A gateway takes minor units, and an unrounded float
//    reaches N-Genius as 123.45000000000002 and is refused.
{
  eq("12,345 rounds to 123.45", processingFeeFor(ALWAYS, {}, 12_345).amount, 123.45);
  eq("1,234.56 rounds to 12.35", processingFeeFor(ALWAYS, {}, 1_234.56).amount, 12.35);
  eq("333 rounds to 3.33", processingFeeFor(ALWAYS, {}, 333).amount, 3.33);
  const f = processingFeeFor(ALWAYS, {}, 12_345).amount;
  check("the fee has at most 2 decimals", Number.isInteger(Math.round(f * 100)), f);
  check("...and survives ×100 into minor units", Math.round((12_345 + f) * 100) === 1_246_845, (12_345 + f) * 100);
}

// 5. Nothing charged on nothing.
{
  eq("a zero base has no fee", processingFeeFor(ALWAYS, {}, 0).amount, 0);
  eq("a negative base has no fee", processingFeeFor(ALWAYS, {}, -100).amount, 0);
}

// 6. The compounding trap, stated as arithmetic. This is why the base is
//    remembered on the case rather than taken from the model each time.
{
  const base = 100_000;
  const first = base + processingFeeFor(ALWAYS, {}, base).amount;
  eq("first link", first, 101_000);
  const naive = first + processingFeeFor(ALWAYS, {}, first).amount;
  eq("a reissue computed from the quoted total would overcharge", naive, 102_010);
  const correct = base + processingFeeFor(ALWAYS, {}, base).amount;
  eq("computed from the remembered base it does not", correct, 101_000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
