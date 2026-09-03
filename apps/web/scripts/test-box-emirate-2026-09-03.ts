/**
 * The emirate on a customer's PO Box list (2026-09-03).
 *
 * A signed-in customer asked to renew and was told box 378795 (DXB) "came back
 * as not found". The box exists. RetailApp names the emirate `cityCode` on the
 * box-list operation and `emirateCode` on the renewal ones; we read only the
 * latter, so `emirate` was undefined for every box, JSON.stringify dropped the
 * key, and the assistant -- handed a box number and no emirate -- guessed Dubai.
 *
 * Every renewal call is keyed on box number AND emirate, so the guess is the
 * whole bug: look a Sharjah box up under DXB and the API correctly says it does
 * not exist, which reads to the customer as their own box not existing.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-box-emirate-2026-09-03.ts
 */
import { mapCustomerPoBoxes } from "@/lib/gsbLookup";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

/** RetailApp's documented Flow A payload, verbatim field names. */
const RETAIL_ROW = {
  bundleName: "MyBox Silver",
  uniqueBoxId: 2378795,
  boxNumber: 378795,
  cityCode: "SHJ",
  cityName: "Sharjah",
  custProfId: "C-1",
  expiryDate: "2026-11-30T00:00:00",
  assignedBranchName: "Sharjah Central",
  boxRelation: 0,
  status: 1,
  bundleId: "MYBOX3",
  ownerName: "A CUSTOMER",
};

// 1. The bug itself: cityCode is the emirate, and it must survive.
{
  const [b] = mapCustomerPoBoxes([RETAIL_ROW]);
  check("cityCode becomes the emirate CODE", b?.emirateCode === "SHJ", b?.emirateCode);
  check("cityName becomes the emirate NAME", b?.emirateName === "Sharjah", b?.emirateName);
  check("box number survives", String(b?.boxNumber) === "378795", b?.boxNumber);
  check("assignedBranchName is read", b?.branch === "Sharjah Central", b?.branch);
  check("status is words, not a number", b?.status === "Active", b?.status);
  // The regression that started it: an undefined emirate vanishes from the JSON
  // the model sees, leaving it a box number and nothing else.
  check("the emirate is not dropped from the serialised form", /SHJ/.test(JSON.stringify(b)), JSON.stringify(b));
}

// 2. The renewal endpoints spell it differently. Both spellings must work, or
//    fixing one operation quietly breaks the other.
{
  const [b] = mapCustomerPoBoxes([{ boxNumber: 70655, emirateCode: "AUH", emirateName: "Abu Dhabi" }]);
  check("emirateCode is still read where RetailApp uses it", b?.emirateCode === "AUH", b?.emirateCode);
  check("emirateName is still read too", b?.emirateName === "Abu Dhabi", b?.emirateName);
}

// 3. boxRelation: 0 = Owner, 1 = Agent. An agent cannot renew on their own
//    account, so this is not cosmetic.
{
  check("relation 0 is the owner", mapCustomerPoBoxes([{ boxRelation: 0 }])[0]?.isOwner === true);
  check("relation 1 is an agent", mapCustomerPoBoxes([{ boxRelation: 1 }])[0]?.isOwner === false);
  check("no relation at all is unknown", mapCustomerPoBoxes([{}])[0]?.isOwner === undefined);
  check("an explicit isOwner still wins", mapCustomerPoBoxes([{ isOwner: false, boxRelation: 0 }])[0]?.isOwner === false);
}

// 4. A box with no emirate anywhere stays undefined rather than being invented.
//    The assistant is told to ask; it must not be handed a default.
{
  const [b] = mapCustomerPoBoxes([{ boxNumber: 12345 }]);
  check("no emirate is undefined, not 'DXB'", b?.emirateCode === undefined, b?.emirateCode);
  check("...and the key is absent from the JSON", !/emirateCode/.test(JSON.stringify(b)), JSON.stringify(b));
}

// 5. Corporate boxes still name their company.
{
  const [b] = mapCustomerPoBoxes([{ boxNumber: 1, rentType: "C", ownerName: "GULF SYSTEM INTERNATIONAL", status: 14 }]);
  check("rentType C is Corporate", b?.rentType === "Corporate", b?.rentType);
  check("holderName is the company", b?.holderName === "GULF SYSTEM INTERNATIONAL", b?.holderName);
  check("status 14 is 'Pending approval', not a failure", b?.status === "Pending approval", b?.status);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
