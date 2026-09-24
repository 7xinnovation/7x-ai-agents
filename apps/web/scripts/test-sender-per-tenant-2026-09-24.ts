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
import { senderFor } from "../lib/email";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const reset = () => {
  delete process.env.EMAIL_FROM; delete process.env.NOTIFICATION_FROM_EMAIL;
  delete process.env.EMAIL_FROM_EPGL; delete process.env.EMAIL_FROM_NXN;
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

console.log("\nEvery send says whose it is");
const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const ops = readFileSync(new URL("../lib/opsNotify.ts", import.meta.url), "utf8");
check("the confirmation-email tool", /html: textToHtml\(bodyText, subject, emailBrand\),\s*\n\s*tenant: agent\.definition\.tenantSlug/.test(route));
check("the automatic completion email", /subject: mail\.subject,\s*\n\s*tenant: agent\.definition\.tenantSlug/.test(route));
check("the ops notifications", /tenant: input\.tenant/.test(ops));
check("...and the route tells opsNotify which tenant it is", /brand: emailBrand,\s*\n\s*tenant: agent\.definition\.tenantSlug/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
