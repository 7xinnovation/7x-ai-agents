/**
 * Noqodi (UAE Pay) on Emirates Post's own gateway (2026-11-23): the save carries
 * paymentProvider 1 when the customer chose Noqodi, and the card's path does
 * the rest. See scripts/nxn-noqodi-via-backend-2026-11-23.ts.
 *
 * Run from apps/web:  npx tsx scripts/test-nxn-noqodi-via-backend-2026-11-23.ts
 */
import { readFileSync } from "node:fs";
import { apply, guidanceBlock, MARK, JOURNEYS } from "./nxn-noqodi-via-backend-2026-11-23";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const integ = src("../lib/integrations.ts");
check("the save is told which provider, from the recorded choice", /if \(\/\(rental_save\|renewal_save\)\$\/i\.test\(toolName\) && opts\.backendUaePay\) \{/.test(integ) && /pay\.paymentProvider = wantUaePay \? 1 : 0;/.test(integ));
check("...a guest choosing Noqodi is refused before anything is saved", /if \(wantUaePay && !opts\.authenticated\) \{\s*return \{\s*result:\s*"UAE PAY NEEDS A SIGN-IN/.test(integ));
check("...and the card on file is not sent with a Noqodi payment", /if \(wantUaePay\) delete pay\.savedCard;/.test(integ));

const route = src("../app/api/chat/route.ts");
check("the route passes the choice as it stands when the save runs", /backendUaePay: noqodiViaBackend\(agent\.definition\)\s*\? \(\) => String\(liveState\.data\.payment_method \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "uaepay"/.test(route));
check("...and a Noqodi order stays a backend-gateway order", /!== "uaepay" \|\| noqodiViaBackend\(agent\.definition\)\),/.test(route));

const tools = src("../../../packages/core/src/ai/tools.ts");
check("request_payment never takes a Noqodi payment the backend takes", /if \(chosenMethod === "uaepay" && offered\.some\(\(m\) => m\.key === "uaepay" && \(m as \{ via\?: string \}\)\.via === "backend"\)\)/.test(tools));
const prompt = src("../../../packages/core/src/ai/prompt.ts");
check("the journey prompt describes the backend path when the method is via the backend", /if \(f\.confirmTool && noqodiViaBackend\)/.test(prompt) && /NEVER call request_payment for this journey/.test(prompt));

// The config script.
const base = {
  tenantSlug: "nxn",
  paymentMethods: [{ key: "gateway", enabled: true }, { key: "uaepay", enabled: false }],
  journeys: JOURNEYS.map((key) => ({ key, guidance: "OLD GUIDANCE", steps: [{ key: "s", fields: [{ key: "terms_accepted" }] }] })),
};
const one = apply(base, { enable: false });
check("via backend is set, the switch left where it was", one.def.paymentMethods[1].via === "backend" && one.def.paymentMethods[1].enabled === false);
check("every rental and renewal gets the field and the block at the top", one.def.journeys.every((j: any) => j.steps[0].fields.some((f: any) => f.key === "payment_method") && j.guidance.startsWith(MARK) && j.guidance.endsWith("OLD GUIDANCE")));
const two = apply(one.def, { enable: false });
check("a second run changes nothing", two.changes.every((c) => c.startsWith("(")), two.changes);
check("--enable switches it on", apply(base, { enable: true }).def.paymentMethods[1].enabled === true);
let refused = false;
try { apply({ ...base, tenantSlug: "epgl" }, { enable: false }); } catch { refused = true; }
check("refuses an agent that is not NXN", refused);
check("the renewal's block names the totals on both buttons", /Pay AED <total> with Card \| Pay AED <total> with UAE PAY/.test(guidanceBlock(true)) && !/Pay AED <total> with Card \|/.test(guidanceBlock(false)));

// The other three of Emre's 23 Nov testing round.
const { redactGuestPII } = await import("../lib/pii");
const guest = JSON.parse(redactGuestPII(JSON.stringify({ poBoxCustomerDetails: { tradeLicenseNo: "300143", tradeLicenseExpiryDate: "01/01/2013 00:00:00" }, poBoxSubscriptionDetails: { currentExpiryDate: "2038-12-20T00:00:00" } })));
check("a guest never sees a corporate box's trade licence or its expiry", guest.poBoxCustomerDetails.tradeLicenseNo === "***" && guest.poBoxCustomerDetails.tradeLicenseExpiryDate === "***", guest);
check("...while the box's own expiry stays readable", guest.poBoxSubscriptionDetails.currentExpiryDate === "2038-12-20T00:00:00");

const { renewalBreakdown } = await import("../lib/integrations");
// Box 1234 (corporate Premium Box), Emirates Post's lines as they came back.
const lines = [
  { service: "AGENT", amount: 3.25, serviceCriteriaDesc: "M" }, { service: "AGENT", amount: 96.75, serviceCriteriaDesc: "M" },
  { service: "TIJARI", amount: 30, serviceCriteriaDesc: "M" }, { service: "TIJARI", amount: 965, serviceCriteriaDesc: "M" },
  { service: "RENT", amount: 75.5, serviceCriteriaDesc: "M" }, { service: "RENT", amount: 2419.5, serviceCriteriaDesc: "M" },
  { service: "AGENT", amount: 3.25, serviceCriteriaDesc: "I" }, { service: "AGENT", amount: 96.75, serviceCriteriaDesc: "I" },
];
const bd = renewalBreakdown(lines);
const get = (l: string) => bd.find((x) => x.label === l)?.amount;
check("3,590 is rental 2,495 + Tijari licence 995 + representative 100", get("Box rental") === 2495 && get("Tijari licence") === 995 && get("Representative") === 100 && bd.reduce((t, l) => t + l.amount, 0) === 3590, bd);
check("...the bundle's included representative is not counted", bd.length === 3);
check("...and the breakdown is added only when its parts make the total", /const adds = amount !== null && Math\.abs\(breakdown\.reduce/.test(integ));

const { gatewayName } = await import("../lib/paymentDetail");
check("the admin names a UAE Pay payment Emirates Post took", gatewayName("ep-uaepay") === "UAE Pay (via Emirates Post)" && gatewayName(null) === "default");
check("...recorded from the payment page they opened", /const backendProvider = settled\?\.url && \/uaepay\/i\.test/.test(route) && /provider: backendProvider,/.test(route));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
