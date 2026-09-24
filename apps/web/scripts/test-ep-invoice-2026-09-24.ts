/**
 * Emirates Post's invoice, not a receipt we drew (2026-09-24).
 *
 * Asked for: when a PO Box purchase or renewal completes, show THEIR invoice
 * instead of the receipt we render. They have one, and the reference it wants
 * is the one the receipt route is already keyed on — `payments.reference` holds
 * their payment GUID for a PO Box journey, the same value their
 * Rental/UpdatePayment takes.
 *
 * Everything asserted below about their endpoint was established by calling it
 * on staging, because their spec declares the 200 body as `{"type":"object"}`.
 *
 * Run from apps/web:  npx tsx scripts/test-ep-invoice-2026-09-24.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`); }
};

const lib = readFileSync(new URL("../lib/epInvoice.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/receipt/[reference]/route.ts", import.meta.url), "utf8");

console.log("\nThe call their API actually wants");
check("the invoice path", /\/api\/v1\/Invoice\?PaymentReferenceNumber=/.test(lib));
check("...asking for the file itself", /IsFile=true/.test(lib));
// Type is documented as a CommonOrderTypes enum and ignored — RENT, RENEWAL and
// no Type at all return the same PDF. Sending one would be a journey-to-order
// mapping to keep correct for nothing.
check("...and NOT sending a Type, because it is ignored", !/[?&]Type=/.test(lib));
check("the reference is encoded", /encodeURIComponent\(\s*\n?\s*paymentReference/.test(lib));
check("it reads the users service already configured", /epUsersBaseUrl\(agentId, env\)/.test(lib));

console.log("\nA customer who paid is always handed something");
// An unknown reference answers 500, so no status reliably means "not found".
check("any non-200 is 'no invoice', not an error", /if \(!res\.ok\) \{/.test(lib) && /return null;/.test(lib));
check("...a non-PDF content type too", /!\/pdf\/i\.test\(type\)/.test(lib));
check("...and a body that is not a PDF", /head !== "%PDF"/.test(lib));
check("a timeout does not hang the download", /AbortController/.test(lib) && /TIMEOUT_MS/.test(lib));
check("every one of those falls through to our receipt", /if \(invoice\) \{/.test(route));

console.log("\nOnly Emirates Post, and only after we have checked who is asking");
check("EPGL still gets the receipt we render", /agent\?\.definition\.tenantSlug === "nxn"/.test(route));
/**
 * Their endpoint takes NO credential — a payment reference is the whole of it.
 * So the conversation check is the only thing between a GUID and somebody's
 * invoice, and it has to run first.
 */
const authAt = route.indexOf("eq(payments.conversationId, conversationId)");
const invoiceAt = route.indexOf("emiratesPostInvoice(");
check("the conversation check runs BEFORE the fetch", authAt > 0 && invoiceAt > authAt, { authAt, invoiceAt });
check("...and the payment must belong to it", /eq\(payments\.reference, reference\), eq\(payments\.conversationId, conversationId\)/.test(route));
check("the fact that their endpoint is open is written down", /carries no authentication at all/.test(lib));

console.log("\nServed as a document, not a download nobody asked for");
check("the right content type", /"Content-Type": "application\/pdf"/.test(route));
check("shown inline, with a name if it is saved", /inline; filename="emirates-post-invoice-/.test(route));
check("not cached — it is somebody's invoice", /"Cache-Control": "no-store"/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
