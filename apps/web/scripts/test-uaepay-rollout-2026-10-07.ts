/**
 * "Pay with Card" or "Pay with Noqodi (UAE Pay)", for every agent (2026-10-07).
 *
 * Three hardenings of the UAEPay adapter and its return path, and the rollout
 * script that puts an agent into the wanted state — exercised on a fixture
 * shaped like EPGL's and NXN's live definitions, both ways and twice.
 *
 * Run from apps/web:  npx tsx scripts/test-uaepay-rollout-2026-10-07.ts
 */
import { readFileSync } from "node:fs";
import { applyRollout, LABELS, MARKER, PROFILES } from "./uaepay-rollout-2026-10-07";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got).slice(0, 300)}`}`); }
};
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

console.log("\nThe adapter sends only our reference back on the redirect");
const adapter = src("../../../packages/core/src/adapters/uaepay.ts");
check("enableSecureRedirect is true on the link", /enableSecureRedirect: true,/.test(adapter));
check("...and the page opens in the conversation's language", /language: input\.locale === "ar" \? "ar" : "en",/.test(adapter));
check("...with the service named for the UAE Pay app and email", /metaData: \{ serviceName: input\.description\.slice\(0, 80\) \}/.test(adapter));

console.log("\nThe return page answers a POST redirect as it answers a GET");
const ret = src("../app/api/payments/return/route.ts");
check("a POST handler exists", /export async function POST\(req: NextRequest\)/.test(ret));
check("...and it is the GET", /export async function POST\(req: NextRequest\) \{\s*return GET\(req\);\s*\}/.test(ret));
check("...which already reads UAEPay's merchantRequestId", /q\.get\("merchantRequestId"\)/.test(ret));

console.log("\nThe pay button may open a UAE Pay or noqodi page");
const md = src("../app/embed/[agent]/Markdown.tsx");
check("uaepay.ae is an allowed host", /PAY_HOSTS = \[[^\]]*"uaepay\.ae"/.test(md));
check("noqodi.com too", /PAY_HOSTS = \[[^\]]*"noqodi\.com"/.test(md));
check("...and N-Genius still is", /PAY_HOSTS = \[[^\]]*"ngenius-payments\.com"/.test(md));

console.log("\nThe admin switches carry the customer's names");
const editor = src("../app/admin/[slug]/Editor.tsx");
check("the card is \"Pay with Card\"", /key: "gateway", label: \{ en: "Pay with Card"/.test(editor));
check("Noqodi is \"Pay with Noqodi \(UAE Pay\)\"", /key: "uaepay"[\s\S]{0,120}en: "Pay with Noqodi \(UAE Pay\)"/.test(editor));
check("...and still arrives switched off", /key: "uaepay", enabled: false/.test(editor));

/** A definition shaped like EPGL staging's on 7 October: two journeys, the 28 September block, the 2 October paragraph. */
const twoChoices = `A \`\`\`buttons block with exactly two choices: "Card payment (online)" and "Bank transfer (Virtual IBAN)". Record the answer with collect_field(payment_method, gateway) or collect_field(payment_method, viban).`;
const oldPara = ` UAEPAY IS THE THIRD WAY TO PAY, and it costs LESS than the card: the licence fee is AED 1,000 and UAEPay adds no online payment fee, so a UAEPay payment is AED 1,000 while a card payment is AED 2,000. State all three prices when you present the choice — card AED 2,000, UAEPay AED 1,000, Virtual IBAN AED 1,000 — rather than mentioning the fee only after they have chosen. UAEPay is for SIGNED-IN applicants only: it requires the payer's Emirates ID, which comes from their UAE PASS sign-in and is never something to ask them for. If the applicant is not signed in, offer card and Virtual IBAN only and do not mention UAEPay.`;
const field = () => ({
  key: "payment_method", type: "enum",
  options: [
    { value: "gateway", label: { en: "Card payment (online)", ar: "الدفع بالبطاقة (عبر الإنترنت)" } },
    { value: "viban", label: { en: "Bank transfer (Virtual IBAN)", ar: "تحويل بنكي (آيبان افتراضي)" } },
  ],
});
const epgl = () => ({
  slug: "epgl-dialog", activeEnvironment: "staging",
  integrations: { payment: { provider: "ngenius", settings: {}, secretRefs: ["NGENIUS_API_KEY"] } },
  journeys: [
    { key: "new_license", guidance: `Front matter. PAYMENT OPTIONS (2026-09-28): (2) ASK how they want to pay. ${twoChoices} Then more.${oldPara}`,
      steps: [{ fields: [{ key: "other" }, field()] }], submission: { amount: 1000, surcharges: [{ key: "online_payment_fee", amount: 1000, when: "payment_method == 'gateway'" }] } },
    { key: "renewal", guidance: `Renewal. ${twoChoices} Tail.`, steps: [{ fields: [field()] }], submission: { amount: 1000, surcharges: [{ key: "online_payment_fee", amount: 1000, when: "payment_method == 'gateway'" }] } },
  ],
});

console.log("\nEPGL switched ON, on staging");
{
  const { def, changes } = applyRollout(epgl(), { enable: true, host: "https://7xagents.7x-lab.com/" });
  check("the three switches, Noqodi on", JSON.stringify(def.paymentMethods.map((m: any) => [m.key, m.enabled])) === JSON.stringify([["gateway", true], ["viban", true], ["uaepay", true]]), def.paymentMethods);
  check("...named for the customer", def.paymentMethods[0].label.en === "Pay with Card" && def.paymentMethods[2].label.en === "Pay with Noqodi (UAE Pay)");
  const b = def.integrations.paymentGateways?.uaepay;
  check("the UAT binding, returning to staging", b?.provider === "uaepay" && b.settings.merchantCode === "MR123093" && b.settings.baseUrl === "https://uat-api.uaepay.ae" && b.settings.returnUrl === "https://7xagents.7x-lab.com/api/payments/return", b);
  check("...naming the secrets, not holding them", JSON.stringify(b?.secretRefs) === JSON.stringify(["UAEPAY_CLIENT_ID", "UAEPAY_CLIENT_SECRET"]));
  for (const j of def.journeys) {
    const f = j.steps.flatMap((s: any) => s.fields).find((f: any) => f.key === "payment_method");
    check(`${j.key}: three options, Noqodi last`, JSON.stringify(f.options.map((o: any) => o.value)) === JSON.stringify(["gateway", "viban", "uaepay"]), f.options);
    check(`${j.key}: the card relabelled on the field`, f.options[0].label.en === "Pay with Card" && f.options[0].label.ar === "الدفع بالبطاقة");
    check(`${j.key}: the buttons sentence names three`, /exactly three choices: "Pay with Card", "Pay with Noqodi \(UAE Pay\)" and "Bank transfer \(Virtual IBAN\)"\. Record the answer with collect_field\(payment_method, gateway\), collect_field\(payment_method, uaepay\) or collect_field\(payment_method, viban\)\./.test(j.guidance), j.guidance);
    check(`${j.key}: the Noqodi paragraph is there once, with this environment's prices`, (j.guidance.match(new RegExp(MARKER, "g")) ?? []).length === 1 && /card payment is AED 2,000/.test(j.guidance) && /Noqodi \(UAE Pay\) payment is AED 1,000/.test(j.guidance));
    check(`${j.key}: ...and the old wording is gone`, !/UAEPay adds no online payment fee/.test(j.guidance) && !/do not mention UAEPay\./.test(j.guidance));
    check(`${j.key}: ...the rest of the guidance untouched`, j.guidance.startsWith(j.key === "renewal" ? "Renewal. " : "Front matter. PAYMENT OPTIONS (2026-09-28): (2) ASK how they want to pay. ") && /Then more\.|Tail\./.test(j.guidance));
  }
  check("every change is named", changes.length >= 6, changes);
  const again = applyRollout(def, { enable: true, host: "https://7xagents.7x-lab.com" });
  check("a second run changes nothing", again.changes.filter((c) => !c.startsWith("(")).length === 0, again.changes);
}

console.log("\nEPGL switched OFF again");
{
  const on = applyRollout(epgl(), { enable: true, host: "https://7xagents.7x-lab.com" }).def;
  const { def } = applyRollout(on, { enable: false });
  check("Noqodi off, the others as they were", JSON.stringify(def.paymentMethods.map((m: any) => [m.key, m.enabled])) === JSON.stringify([["gateway", true], ["viban", true], ["uaepay", false]]));
  check("the binding is kept — wired and switched off", def.integrations.paymentGateways?.uaepay?.provider === "uaepay");
  for (const j of def.journeys) {
    const f = j.steps.flatMap((s: any) => s.fields).find((f: any) => f.key === "payment_method");
    check(`${j.key}: the option is removed`, !f.options.some((o: any) => o.value === "uaepay"));
    check(`${j.key}: two choices, by their new names`, /exactly two choices: "Pay with Card" and "Bank transfer \(Virtual IBAN\)"\./.test(j.guidance) && !/uaepay\)/.test(j.guidance));
    check(`${j.key}: Noqodi is not mentioned anywhere`, !/noqodi|uaepay/i.test(j.guidance), j.guidance);
  }
}

console.log("\nProduction refuses the UAT gateway");
{
  const prod = { ...epgl(), activeEnvironment: "production" };
  let err = "";
  try { applyRollout(prod, { enable: true, host: "https://agent.7x.ae" }); } catch (e) { err = String((e as Error).message); }
  check("...unless told the production merchant", /production agent/.test(err) && /UAT/.test(err), err);
  err = "";
  try { applyRollout(prod, { enable: true, host: "https://agent.7x.ae", baseUrl: "https://api.uaepay.ae", merchant: "MR999999" }); } catch (e) { err = String((e as Error).message); }
  check("...and accepts it", err === "", err);
  const { def } = applyRollout(prod, { enable: false });
  check("preparing the switches alone touches no binding", !def.integrations.paymentGateways && def.paymentMethods[2].enabled === false);
  err = "";
  try { applyRollout(prod, { enable: true, baseUrl: "https://api.uaepay.ae", merchant: "MR999999" }); } catch (e) { err = String((e as Error).message); }
  check("a binding without a return URL is refused", /--host/.test(err), err);
}

console.log("\nNXN: prepared, not offered");
{
  const nxn = {
    slug: "nxn-dialog", activeEnvironment: "staging",
    paymentMethods: [
      { key: "gateway", label: { en: "Card payment (online)", ar: "x" }, enabled: true },
      { key: "viban", label: { en: "Bank transfer (Virtual IBAN)", ar: "x" }, enabled: true },
      { key: "uaepay", label: { en: "UAEPay", ar: "x" }, enabled: false },
    ],
    integrations: { payment: { provider: "ngenius", settings: {}, secretRefs: ["NGENIUS_API_KEY"] } },
    journeys: [{ key: "personal_po_box_rental", guidance: "Rental guidance.", steps: [{ fields: [{ key: "box_number" }] }], submission: { amount: 300, apiFlow: { saveTool: "a", confirmTool: "b" } } }],
  };
  const { def, changes } = applyRollout(nxn, { enable: false, host: "https://7xagents.7x-lab.com", baseUrl: "https://uat-api.uaepay.ae", merchant: "MR123093" });
  check("Virtual IBAN is dropped — NXN has no such route", JSON.stringify(def.paymentMethods.map((m: any) => m.key)) === JSON.stringify(["gateway", "uaepay"]), def.paymentMethods);
  check("...and the drop is named", changes.some((c) => /paymentMethods -= viban/.test(c)), changes);
  check("Noqodi stays off", def.paymentMethods[1].enabled === false);
  check("the binding is prepared", def.integrations.paymentGateways?.uaepay?.settings?.merchantCode === "MR123093");
  check("no field is added and the guidance is untouched", def.journeys[0].guidance === "Rental guidance." && !def.journeys[0].steps[0].fields.some((f: any) => f.key === "payment_method"));
  check("...and the reason is stated", changes.some((c) => /Emirates Post/.test(c)), changes);
  let err = "";
  try { applyRollout(nxn, { enable: true, host: "https://7xagents.7x-lab.com" }); } catch (e) { err = String((e as Error).message); }
  check("switching it on is refused with the reason", /cannot be switched on here yet/.test(err) && /Emirates Post/.test(err), err);
  check("the profile says why", PROFILES["nxn-dialog"]!.offerInChat === false && /confirm/.test(PROFILES["nxn-dialog"]!.why ?? ""));
  check("the labels are the ones in the admin editor", LABELS.gateway!.en === "Pay with Card" && LABELS.uaepay!.en === "Pay with Noqodi (UAE Pay)");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
