/**
 * An expired PO Box is still the customer's box (2026-09-07).
 *
 * Someone signed in on production with an expired box on their account and it
 * did not appear. Emirates Post's own BoxStatus enum has no "Expired" in it —
 * Free, Rented, Blocked, Reserved, EcomReserved, EcomBooked, VirtualFree,
 * Suspended, PendingApproval, RentingRejected, CeoReserved — so a lapsed box
 * keeps whichever status it had and nothing in the payload says it has lapsed.
 *
 * Two things follow. Expiry is read from the DATE, not the status. And a status
 * we have no word for must not reach the customer as a bare number, because a
 * number nobody can read is a box that quietly gets left out of the list.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-expired-boxes-2026-09-07.ts
 */
import { mapCustomerPoBoxes } from "@/lib/gsbLookup";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

const YEAR = 365 * 24 * 60 * 60 * 1000;
const past = new Date(Date.now() - YEAR).toISOString();
const future = new Date(Date.now() + YEAR).toISOString();

// Field names verbatim from UserPoBoxDTO in their own swagger.
const rows = [
  { boxNumber: 450791, cityCode: "DXB", cityName: "Dubai", status: 1, expiryDate: future, bundleId: "IN", boxRelation: 0, rentType: "P", assignedBranchName: "Al Barsha Post Office" },
  { boxNumber: 111111, cityCode: "AUH", cityName: "Abu Dhabi", status: 1, expiryDate: past, bundleId: "IN", boxRelation: 0, rentType: "P" },
  { boxNumber: 222222, cityCode: "SHJ", cityName: "Sharjah", status: 14, expiryDate: future, bundleId: "LI", boxRelation: 0, rentType: "C", ownerName: "A Company LLC" },
  // A status we have never seen and have no word for.
  { boxNumber: 333333, cityCode: "DXB", cityName: "Dubai", status: 7, expiryDate: past, bundleId: "IN", boxRelation: 1, rentType: "P" },
  { boxNumber: 444444, cityCode: "DXB", status: 1, expiryDate: null, bundleId: "IN", boxRelation: 0, rentType: "P" },
];
const mapped = mapCustomerPoBoxes(rows);

// ── nothing is dropped ──────────────────────────────────────────────────────
check("every row survives the mapping", mapped.length === 5, mapped.length);
check("...including the one with an unknown status", mapped.some((b) => b.boxNumber === (333333 as unknown as string)));

// ── expiry comes from the date ──────────────────────────────────────────────
check("a box past its expiry is marked expired", mapped[1]!.expired === true, mapped[1]);
check("a box with time left is not", mapped[0]!.expired === false, mapped[0]);
check("an unknown status does not stop it being seen as expired", mapped[3]!.expired === true, mapped[3]);
check("no expiry date means we do not claim to know", mapped[4]!.expired === undefined, mapped[4]);
check("an ACTIVE status on a lapsed box does not make it active", mapped[1]!.status === "Active" && mapped[1]!.expired === true);

// ── a status we cannot name is still said in words ──────────────────────────
check("known statuses read as words", mapped[0]!.status === "Active" && mapped[2]!.status === "Pending approval");
check("an unknown one is not a bare number", mapped[3]!.status !== "7" && !/^\d+$/.test(String(mapped[3]!.status)), mapped[3]!.status);
check("...and says so plainly", /Status 7/.test(String(mapped[3]!.status)), mapped[3]!.status);

// ── the status Emirates Post actually uses for a lapsed box ─────────────────
// Their spec declares BoxStatus a string enum and the API returns integers, so
// both shapes turn up. A lapsed box most likely wears "Suspended".
const words = mapCustomerPoBoxes([
  { boxNumber: 1, status: "Suspended", expiryDate: past },
  { boxNumber: 2, status: "Rented", expiryDate: future },
  { boxNumber: 3, status: "PendingApproval", expiryDate: future },
  { boxNumber: 4, status: "RentingRejected", expiryDate: future },
  { boxNumber: 5, status: "VirtualFree", expiryDate: future },
  { boxNumber: 6, status: "Blocked", expiryDate: past },
]);
check("Suspended is named as Suspended", words[0]!.status === "Suspended", words[0]);
check("...and is still seen as expired from its date", words[0]!.expired === true);
check("Rented reads as Active", words[1]!.status === "Active");
check("PendingApproval reads as Pending approval", words[2]!.status === "Pending approval");
check("RentingRejected reads as Rejected", words[3]!.status === "Rejected");
check("VirtualFree reads as Free", words[4]!.status === "Free");
check("Blocked is named, not swallowed", words[5]!.status === "Blocked" && words[5]!.expired === true);
check("every one of them is returned", words.length === 6);

// ── the rest of the record still maps ───────────────────────────────────────
check("the emirate CODE comes from cityCode", mapped[0]!.emirateCode === "DXB");
check("the emirate NAME is kept apart from it", mapped[0]!.emirateName === "Dubai");
check("a corporate box names its company", mapped[2]!.holderName === "A Company LLC" && mapped[2]!.rentType === "Corporate");
check("an agent's box is not marked as owned", mapped[3]!.isOwner === false);
check("the branch survives", mapped[0]!.branch === "Al Barsha Post Office");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
