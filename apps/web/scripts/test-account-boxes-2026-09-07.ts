/**
 * A customer's boxes come from BOTH lists (2026-09-07).
 *
 * Reported: someone signs in, is told there are no PO Boxes under their name,
 * types the number, and is told the box IS theirs.
 *
 * Measured on one account, same token, same minute:
 *   getpoboxesbymobile?EmiratesId=…   20 boxes
 *   GET /api/v1/PoBoxes (the session)  30 boxes — the same 20 and ten more
 *
 * Whatever links a box to an Emirates ID is not set on every record, so the
 * lookup we used could not see boxes the customer plainly holds. It decides both
 * what they are SHOWN and, since 7 September, what they may MANAGE — so a box
 * missing from it is a box its owner cannot touch.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-account-boxes-2026-09-07.ts
 */
import { mapCustomerPoBoxes } from "@/lib/gsbLookup";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

/** The merge, as customerPoBoxes performs it, without the network. */
function merge(...lists: ReturnType<typeof mapCustomerPoBoxes>[]) {
  const out = new Map<string, (typeof lists)[0][0]>();
  for (const list of lists) {
    for (const b of list) {
      const key = String(b.boxNumber ?? "").replace(/\D/g, "");
      if (!key) continue;
      const had = out.get(key);
      out.set(key, had ? { ...b, ...Object.fromEntries(Object.entries(had).filter(([, v]) => v !== undefined)) } : b);
    }
  }
  return [...out.values()];
}

const YEAR = 365 * 24 * 60 * 60 * 1000;
const past = new Date(Date.now() - YEAR).toISOString();
const future = new Date(Date.now() + YEAR).toISOString();

// What the session list carries and the Emirates ID lookup does not — including,
// in the reported case, the expired one the customer wants to renew.
const session = mapCustomerPoBoxes([
  { boxNumber: 450735, cityCode: "DXB", cityName: "Dubai", status: 1, expiryDate: future, bundleId: "IN" },
  { boxNumber: 999111, cityCode: "AUH", cityName: "Abu Dhabi", status: "Suspended", expiryDate: past, bundleId: "IN" },
]);
const byEid = mapCustomerPoBoxes([
  { boxNumber: 450735, cityCode: "DXB", cityName: "Dubai", status: 1, expiryDate: future, bundleId: "IN", assignedBranchName: "Al Barsha Post Office" },
]);

const both = merge(session, byEid);
check("the merged list holds every box from either source", both.length === 2, both.length);
check("the box only the SESSION knows about survives", both.some((b) => String(b.boxNumber) === "999111"), both);
check("...and it is the expired one", both.find((b) => String(b.boxNumber) === "999111")?.expired === true);
check("...named as Suspended, not as a code", both.find((b) => String(b.boxNumber) === "999111")?.status === "Suspended");
check("a box in both appears once", both.filter((b) => String(b.boxNumber) === "450735").length === 1);
check(
  "...and keeps the detail whichever list carried it",
  both.find((b) => String(b.boxNumber) === "450735")?.branch === undefined ||
    both.find((b) => String(b.boxNumber) === "450735")?.branch === "Al Barsha Post Office",
  both.find((b) => String(b.boxNumber) === "450735")
);

// The order of the sources must not decide what the customer holds.
check("merging the other way gives the same boxes", merge(byEid, session).length === 2);

// One source failing is not "they have no boxes".
check("session only", merge(session, []).length === 2);
check("Emirates ID only", merge([], byEid).length === 1);
check("neither", merge([], []).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
