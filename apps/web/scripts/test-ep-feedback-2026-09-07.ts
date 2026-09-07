/**
 * Emirates Post's 7 September feedback (2026-09-07).
 *
 * 1. A renewal must offer the upgrade — MyHome to MyHome Instant.
 * 2. The receipt must name the subscriber, the bundle and the new expiry, and
 *    call a renewal a renewal.
 * 3. "Download your receipt" must not ride under every reply for the rest of
 *    the conversation.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-ep-feedback-2026-09-07.ts
 */
import { renewalChoices, upgradesAmong, describeBundle, type RenewalBundle } from "@/lib/renewalBundles";
import { correctPricingInputs } from "@/lib/integrations";
import { factsFromRows, firstJsonObject, shouldOfferReceipt } from "@/lib/receiptFacts";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

// ── 1. the upgrade is there to be offered ───────────────────────────────────
const MYHOME: RenewalBundle = { bundleId: "MYHOME3", bundleName: "MyHome", yearlyPrice: "695" };
const INSTANT: RenewalBundle = { bundleId: "MYHOMEF", bundleName: "MyHome Instant", yearlyPrice: "995" };
const MYBOX: RenewalBundle = { bundleId: "IN", bundleName: "MyBox", yearlyPrice: "300" };

const forMyHome = renewalChoices([MYBOX, MYHOME, INSTANT], MYHOME);
check("MyBox is dropped — a renewal cannot downgrade", forMyHome.dropped === 1, forMyHome);
check("their own bundle is kept", forMyHome.bundles.some((b) => b.bundleId === "MYHOME3"));
check("MyHome Instant is kept", forMyHome.bundles.some((b) => b.bundleId === "MYHOMEF"));

const up = upgradesAmong(forMyHome.bundles, MYHOME);
check("the upgrade is named", up.length === 1 && up[0]!.bundleId === "MYHOMEF", up);
check("...with its price, as a customer would hear it", describeBundle(up[0]!) === "MyHome Instant (AED 995 a year)", describeBundle(up[0]!));

// The reported case: nothing below them, so nothing was filtered — and the old
// code annotated only when something HAD been filtered, so no upgrade was ever
// mentioned. The list is what matters, not whether it shrank.
const noneBelow = renewalChoices([MYHOME, INSTANT], MYHOME);
check("nothing is dropped when they are on the lowest offered tier", noneBelow.dropped === 0);
check("...and the upgrade is STILL there to offer", upgradesAmong(noneBelow.bundles, MYHOME).length === 1);

const top = renewalChoices([MYHOME, INSTANT], INSTANT);
check("the top tier has nothing above it", upgradesAmong(top.bundles, INSTANT).length === 0);
check("...and can still renew where it is", top.bundles.some((b) => b.bundleId === "MYHOMEF"));

// ── the pricing call an upgrade needs ───────────────────────────────────────
const known = { box: "50500", iso: "2026-08-19", bundle: "MYHOME3" };
const upgrade = correctPricingInputs(
  { body: { boxNumber: "50500", emirateCode: "DXB", expiryDate: "2027-08-19T00:00:00", newBundleId: "MYHOMEF" } },
  known,
  new Date("2026-09-07T00:00:00Z")
);
check(
  "asking for the upgrade sets isBundleChanged, which Emirates Post requires",
  (upgrade?.body as Record<string, unknown>)?.isBundleChanged === true,
  upgrade
);
check(
  "...and the upgrade bundle SURVIVES rather than being put back",
  (upgrade?.body as Record<string, unknown>)?.newBundleId === "MYHOMEF",
  upgrade
);

const mistyped = correctPricingInputs(
  { body: { boxNumber: "50500", emirateCode: "DXB", expiryDate: "2027-08-19T00:00:00", newBundleId: "PREMIUM" } },
  known,
  new Date("2026-09-07T00:00:00Z")
);
check(
  "a bundle that is NOT an offered upgrade is still corrected to the box's own",
  (mistyped?.body as Record<string, unknown>)?.newBundleId === "MYHOME3",
  mistyped
);
check("...and is not marked as a change", (mistyped?.body as Record<string, unknown>)?.isBundleChanged !== true, mistyped);

const staying = correctPricingInputs(
  { body: { boxNumber: "50500", emirateCode: "DXB", expiryDate: "2027-08-19T00:00:00", newBundleId: "MYHOME3", isBundleChanged: false } },
  known,
  new Date("2026-09-07T00:00:00Z")
);
check("renewing on the same bundle is left alone", !staying || (staying.body as Record<string, unknown>).newBundleId === "MYHOME3", staying);

// ── 2. what the receipt can now say ─────────────────────────────────────────
// Verbatim shapes from staging: the confirmation carries the box, the emirate,
// the branch, the bundle and the new expiry; the save carries the name.
const CONFIRM = JSON.stringify({
  payload: {
    orderNumber: "260972879",
    paymentDetails: { paymentRefNo: "0147b91c", amountPaid: 13872, maskedCard: "411111******1111" },
    transactionDetails: {
      poBox: "1234", emirateName: "Dubai", officeName: "Al Ras Post Office",
      bundleDesc: "Premium Box", boxExpiryDate: "12/20/2034 00:00:00",
    },
  },
});
const SAVE_BODY = {
  boxNumber: 1234, expiryDate: "2032-12-20T00:00:00", emirateCode: "DXB",
  customerKYC: { firstName: "Ahmed", lastName: "Al Mansoori", email: "a@b.ae" },
};

// The stored response is NOT bare JSON: it is a status line, the body, then the
// guidance appended for the model. Parsing from the first brace to the end of
// the string fails on every one of them, which is how the first version of this
// read a live receipt and came back with no bundle and no branch.
const STORED = `HTTP 200 OK\n${CONFIRM}\n\nDO NOT LINK AN INVOICE FROM THIS RESPONSE. Emirates Post's own invoice endpoint answers 500.`;
check("a note after the body does not stop it being read", Boolean(firstJsonObject(STORED)), STORED.slice(0, 40));
check("a brace inside a string does not end the object", (firstJsonObject('{"a":"}{","b":2}') as { b?: number })?.b === 2);
check("an escaped quote does not end the string", (firstJsonObject('{"a":"say \\"hi\\" }","b":3}') as { b?: number })?.b === 3);
check("nothing parseable yields null", firstJsonObject("HTTP 500\nnot json at all") === null);

const facts = factsFromRows([
  { path: "/api/Guest/Renewal/ConfirmPayment", response: STORED },
  { path: "/api/Guest/Renewal/Save", input: { body: SAVE_BODY } },
]);
check("the subscriber is named", facts.customerName === "Ahmed Al Mansoori", facts.customerName);
check("the bundle is named", facts.bundle === "Premium Box", facts.bundle);
check("the new expiry is the CONFIRMED one, not the requested one", facts.expiry === "2034-12-20", facts.expiry);
check("the box comes from Emirates Post's own answer", facts.poBox === "1234" && facts.emirate === "Dubai", facts);
check("the branch is named", facts.branch === "Al Ras Post Office", facts.branch);
check("their order number is carried", facts.orderNo === "260972879", facts.orderNo);
check("a renewal is recognised as a renewal", facts.operation === "renewal", facts.operation);

const rental = factsFromRows([
  { path: "/api/Rental/Save", input: { body: { boxNumber: 450735, userProfile: { customerNameEN: "Emre Karayalcin" } } } },
]);
check("a rental is recognised as a rental", rental.operation === "rental", rental.operation);
check("...and its name comes from userProfile", rental.customerName === "Emre Karayalcin", rental.customerName);

const nothing = factsFromRows([]);
check("with no calls, nothing is invented", Object.keys(nothing).length === 0, nothing);

// ── 3. the link that would not go away ──────────────────────────────────────
const PAID = { status: "paid", reference: "pay-1" };
const NONE = { status: "none", reference: null };
check("the turn the payment arrives", shouldOfferReceipt(NONE, PAID, "I have paid"));
check("a settled payment after an initiated one", shouldOfferReceipt({ status: "initiated", reference: "pay-1" }, PAID, "done"));
check("the NEXT reply does not carry it", !shouldOfferReceipt(PAID, PAID, "Yes, show me the list"));
check("nor the one after that", !shouldOfferReceipt(PAID, PAID, "I know my authority"));
check("...but asking for it brings it back", shouldOfferReceipt(PAID, PAID, "can I have my receipt again?"));
check("...in Arabic too", shouldOfferReceipt(PAID, PAID, "أريد الإيصال من فضلك"));
check("a SECOND payment in the same conversation carries its own", shouldOfferReceipt(PAID, { status: "paid", reference: "pay-2" }, "paid again"));
check("an unpaid conversation never carries one", !shouldOfferReceipt(NONE, NONE, "receipt"));
check("paid with no reference is not offerable", !shouldOfferReceipt(NONE, { status: "paid", reference: null }, "hi"));
check("'receipts of the trade licence' is still a request for one", shouldOfferReceipt(PAID, PAID, "receipt"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
