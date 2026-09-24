/**
 * EPGL's mail comes from EPGL's address (2026-09-24).
 *
 * Asked for: switch the EPGL agent's sender from no-reply@7x-lab.com to
 * licensing.department@epg.ae. EMAIL_FROM is ONE setting and both agents send
 * through it, so changing it would have put Emirates Post's mail on EPGL's
 * address too — the same shape as the host-token key checking the wrong host's
 * token, which cost a day, so it is built before the domain is ready rather
 * than after.
 *
 * Run from apps/web:  npx tsx scripts/test-sender-per-tenant-2026-09-24.ts
 */
import { readFileSync } from "node:fs";
import { emailConfigured, providerFor, senderFor } from "../lib/email";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const reset = () => {
  for (const k of [
    "EMAIL_FROM", "NOTIFICATION_FROM_EMAIL", "EMAIL_FROM_EPGL", "EMAIL_FROM_NXN",
    "RESEND_API_KEY", "RESEND_API_KEY_EPGL", "EMAIL_WEBHOOK_URL", "EMAIL_WEBHOOK_URL_EPGL",
  ]) delete process.env[k];
};

console.log("\nOne sender each");
{
  reset();
  process.env.EMAIL_FROM = "Agents <no-reply@7x-lab.com>";
  process.env.EMAIL_FROM_EPGL = "EPGL Licensing <licensing.department@epg.ae>";
  check("EPGL sends as EPGL", senderFor("epgl") === "EPGL Licensing <licensing.department@epg.ae>");
  // The assertion that matters: the switch must not follow the other agent.
  check("Emirates Post does NOT", senderFor("nxn") === "Agents <no-reply@7x-lab.com>", senderFor("nxn"));
  check("...nor does anything unnamed", senderFor() === "Agents <no-reply@7x-lab.com>");
}

console.log("\nAnd nothing changes where senders are not split");
{
  reset();
  process.env.EMAIL_FROM = "Agents <no-reply@7x-lab.com>";
  check("every tenant uses the shared address", senderFor("epgl") === senderFor("nxn") && senderFor("epgl") === "Agents <no-reply@7x-lab.com>");
  reset();
  process.env.NOTIFICATION_FROM_EMAIL = "Agents <no-reply@7x-lab.com>";
  check("the alias spelling still works", senderFor("epgl") === "Agents <no-reply@7x-lab.com>");
  reset();
  // The sandbox sender delivers ONLY to the Resend account owner, so this is a
  // last resort and never a customer-facing address.
  check("nothing configured falls back to the sandbox sender", senderFor("epgl").includes("resend.dev"));
  process.env.EMAIL_FROM_EPGL = "   ";
  check("...and a blank override does not win", senderFor("epgl").includes("resend.dev"));
}

console.log("\nAn entity that sends from its own address sends through its own service");
{
  reset();
  process.env.RESEND_API_KEY = "ours";
  process.env.EMAIL_FROM = "Agents <no-reply@7x-lab.com>";
  process.env.RESEND_API_KEY_EPGL = "theirs";
  process.env.EMAIL_FROM_EPGL = "EPGL Licensing <licensing.department@epg.ae>";
  check("EPGL goes out through EPGL's key", providerFor("epgl").resendKey === "theirs");
  check("...and Emirates Post through ours", providerFor("nxn").resendKey === "ours");
  check("EPGL is marked as using its own", providerFor("epgl").own && !providerFor("nxn").own);
}
{
  // Taken WHOLE: a tenant with its own relay must not borrow the shared key.
  reset();
  process.env.RESEND_API_KEY = "ours";
  process.env.EMAIL_WEBHOOK_URL_EPGL = "https://epg.example/relay";
  check("their relay does not fall back to our key", providerFor("epgl").resendKey === undefined);
  check("...and is the provider that will be used", providerFor("epgl").webhookUrl === "https://epg.example/relay");
}
{
  /**
   * The refusal that matters. Their address configured and their provider not
   * means their mail would leave OUR account under a domain we cannot prove we
   * own — rejected or spam-foldered, with nobody knowing why. Refused instead.
   */
  reset();
  process.env.RESEND_API_KEY = "ours";
  process.env.EMAIL_FROM_EPGL = "EPGL Licensing <licensing.department@epg.ae>";
  check("their address on our account is refused, not sent", providerFor("epgl").own === false);
  check("...and email is still 'configured' for everyone else", emailConfigured("nxn"));
}

console.log("\nEvery send says whose it is");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const ops = readFileSync(new URL("../lib/opsNotify.ts", import.meta.url), "utf8");
check("the confirmation-email tool", /html: textToHtml\(bodyText, subject, emailBrand\),\s*\n\s*tenant: agent\.definition\.tenantSlug/.test(route));
check("the automatic completion email", /subject: mail\.subject,\s*\n\s*tenant: agent\.definition\.tenantSlug/.test(route));
check("the ops notifications", /tenant: input\.tenant/.test(ops));
check("...and the route tells opsNotify which tenant it is", /brand: emailBrand,\s*\n\s*tenant: agent\.definition\.tenantSlug/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
