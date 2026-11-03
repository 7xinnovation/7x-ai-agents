/**
 * A payment we wrote off is asked about once more (3 November 2026).
 *
 * LR-54112: UAEPay's inquiry answered "Unable to find order ... for merchant
 * TEST200200014775" seventy seconds after the link was made — a lookup that
 * found nothing, not a refusal — and the chat's 2.5-second poll wrote `failed`.
 * The customer then completed the payment. Nothing asked again, because every
 * path that could have stops at a row that has left `initiated`.
 *
 * Source assertions: the sweep is a route handler and the adapter is the part
 * that decides, so what is pinned here is the shape of the decision.
 *
 * Run from apps/web:  npx tsx scripts/test-payment-written-off-2026-11-03.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

const sweep = readFileSync(new URL("../app/api/payments/reconcile/route.ts", import.meta.url), "utf8");
const status = readFileSync(new URL("../app/api/payments/status/route.ts", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../../../packages/core/src/adapters/uaepay.ts", import.meta.url), "utf8");

console.log("\nthe adapter no longer calls a not-found a failure");
check("a FAILURE that cannot find the order leaves it open",
  /if \(status === "FAILURE" && notFound\) return \{ status: "initiated", detail \};/.test(adapter));
check("...and a FAILURE that is a refusal still fails",
  /if \(status === "FAILURE"\) return \{ status: "failed", detail \};/.test(adapter));
check("the not-found is their code and their wording, not a guess",
  /INVALID_REQUEST/.test(adapter) && /unable to find \(order\|transaction\)/i.test(adapter));

console.log("\nthe sweep asks again about a recent failure");
check("it selects failed rows", /eq\(payments\.status, "failed"\)/.test(sweep));
check("...bounded by a window", /FAILED_RECHECK_MIN/.test(sweep) && /writtenOffCut/.test(sweep));
check("...which is configurable", /RECONCILE_FAILED_RECHECK_MIN/.test(sweep));
check("it can ONLY upgrade", /if \(status !== "paid"\) continue; \/\/ only ever upgrades/.test(sweep));
check("a payment found paid is written back", /payment_paid_after_being_written_off/.test(sweep));
check("...and EPGL are told, which is the whole point",
  sweep.indexOf("payment_paid_after_being_written_off") < sweep.lastIndexOf("notifyEpglIfLicenceFee"));
check("the case moves with it", /saveCase\(c\.caseId, setPayment\(c\.state, \{ status \}\)\)/.test(sweep));

console.log("\nwhy nothing else could have caught it");
check("the status route returns the stored verdict once a row leaves initiated",
  /if \(pay\.status !== "initiated" \|\| !pay\.agentId\) \{\s*\n\s*return NextResponse\.json\(\{ status: pay\.status \}/.test(status));
check("...and the original sweep pass only looks at initiated",
  /eq\(payments\.status, "initiated"\), lt\(payments\.createdAt, staleCut\)/.test(sweep));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
