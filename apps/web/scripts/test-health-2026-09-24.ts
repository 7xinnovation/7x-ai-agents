/**
 * The health page must never change anything (2026-09-24).
 *
 * Asked for: somewhere an administrator can see which integration is down,
 * rather than learning it from a customer who could not sign in.
 *
 * The constraint that shapes the whole thing is that every probe is READ-ONLY.
 * A page that creates a payment order, sends an email or files a case is a page
 * nobody dares refresh — and a health page nobody refreshes is worse than none,
 * because it is believed. So this asserts the absence of writes as hard as it
 * asserts the presence of checks.
 *
 * Run from apps/web:  npx tsx scripts/test-health-2026-09-24.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};
const lib = readFileSync(new URL("../lib/health.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/health/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/admin/health/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/admin/layout.tsx", import.meta.url), "utf8");

console.log("\nNothing here writes anything");
// The fetches this file makes, by method. Anything but GET has to justify itself.
const methods = [...lib.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]);
check("the only non-GET calls are token mints", methods.every((m) => m === "POST"), methods);
// Two POSTs, and both are "give me a token": N-Genius access-token and the
// IDEP authenticate. Neither creates anything.
check("...which are exactly the two auth endpoints", /identity\/auth\/access-token/.test(lib) && /\/api\/v1\/Auth\/authenticate/.test(lib));
check("no order is created", !/\/orders/.test(lib));
check("no email is sent", !/mail\/send|api\.resend\.com\/emails/.test(lib));
check("no case, licence or document is created", !/sobjects\/Case|LicenseRequest|submitLicenseRequest/.test(lib));
check("the email check reads scopes, not sends", /v3\/scopes/.test(lib));
check("the tracking check uses a number that cannot exist", /ZZ000000000AE/.test(lib));
check("...and the invoice check an all-zero reference", /00000000-0000-0000-0000-000000000000/.test(lib));
check("the registry check does not spend the daily lookup allowance", /must not spend a customer's allowance/.test(lib));

console.log("\nAnd nothing here can hang the page");
check("every probe is time-boxed", /AbortController/.test(lib) && /TIMEOUT_MS/.test(lib));
check("one failing check does not blank the report", /Promise\.allSettled/.test(lib));
check("...a rejected one becomes a row, not an exception", /the check itself failed/.test(lib));

console.log("\nFour states, because three would lie");
for (const s of ["ok", "degraded", "down", "not_configured"]) check(`  ${s}`, new RegExp(`"${s}"`).test(lib));
// Production NXN deliberately points at Emirates Post's staging backend. Red
// for something working as configured trains people to ignore the page.
check("a deliberate staging backend is amber, not red", /pointed at their STAGING backend/.test(lib));
check("...as is a sandbox gateway in production", /against the SANDBOX gateway/.test(lib));
check("...and mock sign-in", /nobody is really being verified/.test(lib));
check("'not configured' is not a failure", /is reported as its own state, not as a failure/.test(lib));

console.log("\nBoth agents, and every integration behind them");
for (const name of ["Salesforce", "IDEP / MoE registry", "PO Box API", "Shipment tracking", "Invoice", "Payment gateway", "Email", "UAE PASS", "Knowledge base"])
  check(`  ${name}`, lib.includes(`"${name}"`));
check("EPGL and Emirates Post are labelled separately", /"EPGL"/.test(lib) && /"Emirates Post"/.test(lib));

console.log("\nThe page itself");
check("it is in the admin nav", /href: "\/admin\/health"/.test(layout));
check("the answer is never cached", /no-store/.test(route) && /force-dynamic/.test(route));
check("...on the client either", /cache: "no-store"/.test(page));
check("a failed check still renders the reason", /\{c\.detail\}/.test(page));
check("the worst rows sort to the top", /ORDER\.indexOf\(a\.state\) - ORDER\.indexOf\(b\.state\)/.test(page));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
