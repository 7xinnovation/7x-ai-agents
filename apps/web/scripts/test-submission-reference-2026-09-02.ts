/**
 * Which id a submission is recorded against (2026-09-02).
 *
 * The composite creates an Account, contacts, partners, documents and the
 * licence request itself, and everything downstream hangs off picking the right
 * one: the reference shown to the customer, and the parent that every uploaded
 * file is attached to.
 *
 * On 2 Sep LR-37176 was created as a11FW000Uygg8hsYIA and we recorded
 * a3jFW0001wOjRySYAV. Both of the customer's documents went to that other
 * record, and the application looked empty. The cause was reading the id
 * NEAREST BEFORE the referenceId, which is only correct when the item happens to
 * serialise body-first.
 *
 * Run from apps/web:  npx tsx scripts/test-submission-reference-2026-09-02.ts
 */
import { submissionReference } from "@dialog/core";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

const LR = "a11FW000Uygg8hsYIA";
const OTHER = "a3jFW0001wOjRySYAV";
const ACCOUNT = "0015f00000AAAAAAAA";

const wrap = (items: unknown[]) => `HTTP 200 OK\n${JSON.stringify({ compositeResponse: items })}`;

// Body first — the order the old code assumed.
check("body-first item resolves the licence request",
  submissionReference(wrap([
    { body: { id: ACCOUNT, success: true }, referenceId: "NewAccount" },
    { body: { id: OTHER, success: true }, referenceId: "NewDocument" },
    { body: { id: LR, success: true }, referenceId: "NewLicenseRequest" },
  ])) === LR);

// referenceId first — the order that broke it. The id before the licence
// request's referenceId belongs to the PREVIOUS item.
check("referenceId-first item still resolves the licence request",
  submissionReference(wrap([
    { referenceId: "NewAccount", body: { id: ACCOUNT, success: true } },
    { referenceId: "NewDocument", body: { id: OTHER, success: true } },
    { referenceId: "NewLicenseRequest", body: { id: LR, success: true } },
  ])) === LR,
  submissionReference(wrap([
    { referenceId: "NewAccount", body: { id: ACCOUNT, success: true } },
    { referenceId: "NewDocument", body: { id: OTHER, success: true } },
    { referenceId: "NewLicenseRequest", body: { id: LR, success: true } },
  ])));

// The array fan-out suffixes the referenceId.
check("a fanned-out referenceId is matched",
  submissionReference(wrap([
    { referenceId: "NewContact_0", body: { id: OTHER, success: true } },
    { referenceId: "NewLicenseRequest_0", body: { id: LR, success: true } },
  ])) === LR);

// Order within the array must not matter either.
check("the licence request first is still found",
  submissionReference(wrap([
    { referenceId: "NewLicenseRequest", body: { id: LR, success: true } },
    { referenceId: "NewAccount", body: { id: ACCOUNT, success: true } },
  ])) === LR);

// A bare array rather than a compositeResponse wrapper.
check("a bare array works",
  submissionReference(`HTTP 200 OK\n${JSON.stringify([
    { referenceId: "NewAccount", body: { id: ACCOUNT, success: true } },
    { referenceId: "NewLicenseRequest", body: { id: LR, success: true } },
  ])}`) === LR);

// Failure must stay a failure.
check("a rolled-back composite is not a submission",
  submissionReference(wrap([
    { referenceId: "NewLicenseRequest", body: { success: false, message: "Rolled back due to allOrNone=true: …" } },
  ])) === null);
check("no success marker is not a submission", submissionReference("HTTP 200 OK\n{}") === null);

// No licence request in the response: report the submission, but NOT with
// another record's id -- that is what sent the documents astray.
const noLr = submissionReference(wrap([{ referenceId: "NewAccount", body: { id: ACCOUNT, success: true } }]));
check("without a licence request item, no foreign id is returned", noLr !== ACCOUNT, noLr);
check("but the submission is still reported", noLr === "submitted", noLr);
check("and that marker cannot pass for a Salesforce id", !/^[a-zA-Z0-9]{15,18}$/.test(String(noLr)));

// Unparseable body: pair by item, not by distance.
check("a truncated body still pairs within the item",
  submissionReference(
    `HTTP 200 OK\n{"compositeResponse":[{"referenceId":"NewAccount","body":{"id":"${ACCOUNT}","success":true}},` +
    `{"referenceId":"NewLicenseRequest","body":{"id":"${LR}","success":true`
  ) === LR);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
