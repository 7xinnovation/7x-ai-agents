/**
 * "In the emails for VIBAN, it should mention that you will be provided the
 * VIBAN" (EPGL feedback round, 21 September).
 *
 * Choosing bank transfer leaves the application submitted and unpaid, and the
 * confirmation email said only "Payment: Bank transfer (Virtual IBAN)". That
 * reads as an instruction to go and transfer something, to an account nobody
 * has given them. The IBAN is issued by Emirates Post Group Licensing
 * afterwards, through a process that does not run on this platform.
 *
 * Run from apps/web:  npx tsx scripts/test-viban-email-2026-09-21.ts
 */
import { completionEmail } from "../lib/completionEmail";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};

const facts = (method: string, status: string) => ({
  journeyKey: "new_license",
  status: "submitted",
  reference: "LR-37533",
  data: { payment_method: method, company_name: "ECONOMIC ADVANTAGE IT CONSULTANTS" } as Record<string, unknown>,
  documents: [] as { key: string; status: string; fileName?: string }[],
  payment: { status, amount: 100700, currency: "AED", reference: null as string | null },
}) as never;

const mail = (method: string, status = "none", locale = "en") =>
  completionEmail({
    agentName: "EPGL Dialog",
    locale,
    reference: "LR-37533",
    contactName: "Emre",
    replyText: "Your application has been submitted.",
    facts: facts(method, status),
  }).text;

console.log("\nA bank-transfer application says the IBAN is coming");
{
  const t = mail("viban");
  check("the block is there", /Paying by bank transfer/.test(t), t.slice(0, 200));
  check("...and says who sends it", /Emirates Post Group Licensing will send you the Virtual IBAN/.test(t));
  check("...and to wait rather than guess an account", /do not transfer to any other account/.test(t));
  check("...and not to reuse an old one", /do not use a Virtual IBAN from an earlier application/.test(t));
  check("...and that the application is safe meanwhile", /Your application stays with them while you pay/.test(t));
}

console.log("\nIn Arabic too");
{
  const t = mail("viban", "none", "ar");
  check("the heading", /الدفع عبر التحويل البنكي/.test(t), t.slice(0, 120));
  check("the promise", /سترسل لك مجموعة بريد الإمارات للتراخيص رقم الآيبان الافتراضي/.test(t));
  check("...and the warning about another account", /ولا تقم بالتحويل إلى أي حساب آخر/.test(t));
}

console.log("\nAnd nowhere else");
for (const [what, method, status] of [
  ["a card payment that settled", "card", "paid"],
  ["a bank transfer that has SETTLED — the receipt speaks for itself", "viban", "paid"],
  ["no payment method chosen", "", "none"],
  ["a card payment not yet made", "card", "none"],
] as const) {
  const t = mail(method, status);
  check(`${what}: no IBAN block`, !/Paying by bank transfer/.test(t), t.slice(0, 160));
}

console.log("\nThe rest of the email is untouched");
{
  const t = mail("viban");
  check("it still names the reference", /LR-37533/.test(t));
  check("it still greets them", /Dear Emre,/.test(t));
  check("it still signs off", /automated message/.test(t));
  check("no blank-line pile-up", !/\n{3,}/.test(t), JSON.stringify(t.slice(0, 300)));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
