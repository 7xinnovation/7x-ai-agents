/**
 * The Virtual IBAN branch of EPGL's payment process map.
 *
 * Two things must hold, and neither may depend on the model: an applicant who
 * chose the Virtual IBAN must never be shown a card, and Finance must be told
 * to raise one — with the company details their process map has them look up by
 * hand.
 *
 * Run from apps/web:  npx tsx scripts/test-viban-2026-09-08.ts
 */
import { notifyOpsForSubmission } from "../lib/opsNotify";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
}

const CASE = {
  payment_method: "viban",
  company_name: "YI FANG TAIWAN FRUIT TEA L.L.C",
  company_name_ar: "اي فانغ تايوان فروت للشاي ش.ذ.م.م",
  trade_license_number: "697670",
  license_issue_date: "2024-11-05",
  license_expiry_date: "2026-11-04",
  emirate: "Dubai",
  contact_name: "Emre Karayalcin",
  contact_email: "applicant@example.com",
  contact_phone: "0553708434",
};

const notify = (data: Record<string, unknown>) =>
  notifyOpsForSubmission({ reference: "a11FW000VfuZVYGYI4", journeyKey: "new_license", data, agentName: "EPGL Dialog" });

console.log("\nFinance is asked to raise the IBAN");
{
  // No recipient configured: the outcome must still be produced and reported,
  // never silently skipped -- that is how a submission goes unnoticed.
  delete process.env.EPGL_FINANCE_EMAIL;
  const out = await notify(CASE);
  const v = out.find((o) => o.kind === "viban_request");
  check("a viban_request outcome is produced", !!v, out.map((o) => o.kind));
  check("and it reports why nothing was sent", v?.result.ok === false && (v.result as any).reason === "recipient_not_configured", v?.result);
}
{
  process.env.EPGL_FINANCE_EMAIL = "finance@example.com";
  const out = await notify(CASE);
  const v = out.find((o) => o.kind === "viban_request");
  check("addressed to the configured Finance mailbox", v?.to === "finance@example.com", v?.to);
}

console.log("\nOnly when the Virtual IBAN was actually chosen");
{
  process.env.EPGL_FINANCE_EMAIL = "finance@example.com";
  const card = await notify({ ...CASE, payment_method: "gateway" });
  check("a card payment raises nothing", !card.some((o) => o.kind === "viban_request"), card.map((o) => o.kind));
  const none = await notify({ ...CASE, payment_method: "" });
  check("an unanswered choice raises nothing", !none.some((o) => o.kind === "viban_request"), none.map((o) => o.kind));
  const upper = await notify({ ...CASE, payment_method: "VIBAN" });
  check("the value is read case-insensitively", upper.some((o) => o.kind === "viban_request"), upper.map((o) => o.kind));
}

console.log("\nrequest_payment refuses a Virtual IBAN outright");
{
  // The gate reads the case, so it holds whatever the model was told.
  const tools = await import("../../../packages/core/src/ai/tools");
  const src = (await import("node:fs")).readFileSync(
    new URL("../../../packages/core/src/ai/tools.ts", import.meta.url), "utf8"
  );
  check("the guard exists in request_payment", /payment_method[\s\S]{0,400}?method === "viban"/.test(src));
  check("it is refused, not merely discouraged", /method === "viban"[\s\S]{0,900}?isError: true/.test(src));
  check("it says nothing was charged", /method === "viban"[\s\S]{0,900}?NOTHING has been charged/.test(src));
  check("it offers the way back to a card", /method === "viban"[\s\S]{0,900}?collect_field\(payment_method, gateway\)/.test(src));
  // It must sit BEFORE the gateway is ever reached.
  const guard = src.indexOf('method === "viban"');
  const initiate = src.indexOf("adapters.payment.initiate");
  check("the guard runs before the gateway is called", guard !== -1 && initiate !== -1 && guard < initiate, { guard, initiate });
  check("tools module still loads", typeof tools === "object");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
