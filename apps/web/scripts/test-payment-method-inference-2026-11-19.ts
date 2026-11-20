/**
 * "I clicked on UAE Pay on EPGL 2.0, but it opened N-Genius" (2026-11-19).
 *
 * LR-54536: payment_method was never recorded, so request_payment fell through
 * to the agent's single `payment` binding (N-Genius). Now an empty method on an
 * agent offering several is read from the customer's message, or refused.
 *
 * Run from apps/web:  npx tsx scripts/test-payment-method-inference-2026-11-19.ts
 */
import { readFileSync } from "node:fs";
import { inferPaymentMethod } from "@dialog/core";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

// EPGL 2.0 staging's live list, as it is in the database.
const EPGL = [
  { key: "gateway", label: { en: "Pay with Card", ar: "الدفع بالبطاقة" } },
  { key: "uaepay", label: { en: "Pay with Noqodi (UAE Pay)", ar: "الدفع عبر نقودي (UAE Pay)" } },
];

console.log("\nThe button labels decide");
check("UAE Pay button → uaepay", inferPaymentMethod(EPGL, "Pay with Noqodi (UAE Pay)") === "uaepay", inferPaymentMethod(EPGL, "Pay with Noqodi (UAE Pay)"));
check("card button → gateway", inferPaymentMethod(EPGL, "Pay with Card") === "gateway");
check("Arabic UAE Pay button → uaepay", inferPaymentMethod(EPGL, "الدفع عبر نقودي (UAE Pay)") === "uaepay");
check("Arabic card button → gateway", inferPaymentMethod(EPGL, "الدفع بالبطاقة") === "gateway");

console.log("\nTyped answers");
check("'noqodi please' → uaepay", inferPaymentMethod(EPGL, "noqodi please") === "uaepay");
check("'uae pay' → uaepay", inferPaymentMethod(EPGL, "I'll use uae pay") === "uaepay");
check("'by card' → gateway", inferPaymentMethod(EPGL, "by card") === "gateway");

console.log("\nNo choice is not a choice");
check("'pay now' → nothing", inferPaymentMethod(EPGL, "pay now") === undefined);
check("both named → nothing", inferPaymentMethod(EPGL, "card or noqodi?") === undefined);
check("empty → nothing", inferPaymentMethod(EPGL, undefined) === undefined);
check("a method not offered is not inferred", inferPaymentMethod([EPGL[0]!], "noqodi") === undefined);

console.log("\nWired into request_payment");
const tools = readFileSync(new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8");
check("only when nothing is recorded and several are on", /if \(!String\(state\.data\["payment_method"\] \?\? ""\)\.trim\(\)\) \{\s*const live = [^;]+;\s*if \(live\.length > 1\)/.test(tools));
check("...the inferred key is recorded on the case", /state = \{ \.\.\.state, data: \{ \.\.\.state\.data, payment_method: inferred \} \};/.test(tools));
check("...otherwise nothing opens", /PAYMENT METHOD NOT RECORDED/.test(tools));
check("...and it runs before the gateway is chosen", tools.indexOf("PAYMENT METHOD NOT RECORDED") < tools.indexOf("const pay = adapters.paymentFor?.(chosenMethod)"));

// LR-38161 (2026-11-20): the model recorded "noqodi"; a near-miss key is mapped, not refused.
check("recorded 'noqodi' → uaepay", inferPaymentMethod(EPGL, "noqodi") === "uaepay");
check("recorded 'card' → gateway", inferPaymentMethod(EPGL, "card") === "gateway");
check("recorded 'bank transfer' → viban", inferPaymentMethod([...EPGL, { key: "viban", label: { en: "Bank transfer (Virtual IBAN)", ar: "" } }], "bank transfer") === "viban");
check("a near-miss key on the case is mapped before the checks", /if \(recorded && all\.length && !all\.some\([^)]*\)[^{]*\{\s*const mapped = inferPaymentMethod\(all, recorded\);/.test(tools));
check("...before the method is read for VIBAN and the gateway", tools.indexOf("const mapped = inferPaymentMethod(all, recorded)") < tools.indexOf('if (method === "viban")'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
