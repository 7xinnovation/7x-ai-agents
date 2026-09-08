/**
 * A rental IS a submission (2026-09-08).
 *
 * submissionReference began by requiring `"success": true`, which is EPGL's
 * Salesforce composite talking. Emirates Post answers a save with
 * {"payload":{"orderNo":"260972889", …}} and no such field, so every rental and
 * every renewal failed the first line of the function — no submission was
 * surfaced, and everything hanging off one was silently absent: the
 * case_submitted audit row, journey.completed, the completion rate on the
 * dashboard, and the ops emails to the branch and the EMX team.
 *
 * Production on 8 September: 20 journeys started, one payment of AED 695 taken
 * and recorded, zero submissions.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-submission-reference-2026-09-08.ts
 */
import { submissionReference } from "@dialog/core";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

// Verbatim shapes from the audit log.
const RENTAL = `HTTP 200 OK\n${JSON.stringify({
  payload: {
    orderNo: "260972889",
    custProfID: "6543391",
    paymentGateWayResponse: { paymentUrl: "https://paypage.sandbox.ngenius-payments.com/v2?code=abc", referenceNumber: "f037d405" },
  },
})}`;
const RENEWAL = `HTTP 200 OK\n${JSON.stringify({
  payload: { orderNumber: "260972905", orderExpiryDate: "2026-09-09T14:21:08", uniqueBoxId: "903330" },
})}`;

check("a rental save is a submission", submissionReference(RENTAL) === "260972889", submissionReference(RENTAL));
check("a renewal save is too", submissionReference(RENEWAL) === "260972905", submissionReference(RENEWAL));
check("...and the reference is Emirates Post's own order number", /^\d{6,}$/.test(String(submissionReference(RENTAL))));

// A failure is still a failure.
check("a refused save is not a submission", submissionReference(`HTTP 400\n${JSON.stringify({ IsSuccess: false, ResponseCode: 105, orderNo: null })}`) === null);
check("a rolled-back composite is not", submissionReference(`{"success":true,"note":"rolled back","orderNo":"1"}`) === null);
check("an explicit success:false is not", submissionReference(`{"success":false,"orderNo":"260972889"}`) === null);
check("a response with neither is not", submissionReference(`HTTP 200\n{"payload":{"boxNumber":450735}}`) === null);
check("a timeout is not", submissionReference("TIMED OUT WITH THE OUTCOME UNKNOWN.") === null);

// EPGL's own shape must be untouched — its id, not an order number.
const EPGL = JSON.stringify({
  success: true,
  compositeResponse: [
    { referenceId: "NewAccount", body: { id: "001FW00001abcdefGHI" } },
    { referenceId: "NewLicenseRequest", body: { id: "a11FW000Uygg8hsYIA" } },
  ],
});
check("EPGL still yields the licence request's id", submissionReference(EPGL) === "a11FW000Uygg8hsYIA", submissionReference(EPGL));
check(
  "...even though the word 'order' appears elsewhere in it",
  submissionReference(JSON.stringify({ success: true, note: "no orderNo here", compositeResponse: [{ referenceId: "NewLicenseRequest", body: { id: "a11FW000Uygg8hsYIA" } }] })) === "a11FW000Uygg8hsYIA"
);
check(
  "an EPGL success with nothing identifiable still reports a submission",
  submissionReference(`{"success":true,"compositeResponse":[]}`) === "submitted"
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
