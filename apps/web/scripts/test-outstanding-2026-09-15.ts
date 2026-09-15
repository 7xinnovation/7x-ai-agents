/**
 * What EPGL's records say is outstanding, and what the agent may do with it.
 *
 * Their renewal process map has a step reading "System calculates renewal fees
 * and penalties if any". We calculate none of it — Salesforce holds every
 * figure as a rollup, and a penalty there carries an approval state
 * (EPG_Penalty_Status__c, EPG_Is_CEO_Approved__c, a legal-action flag) with
 * some still in Draft. So the agent STATES what is outstanding and does not
 * total it, and the payable figure stays the one EPGL put in the payment
 * request after the document review.
 *
 * Run from apps/web:  npx tsx scripts/test-outstanding-2026-09-15.ts
 */
import { outstandingSummary } from "../lib/epglRead";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

console.log("\nA clean licence says nothing at all");
check("no fees at all", outstandingSummary(undefined) === null);
check("every figure zero", outstandingSummary({ form9Penalties: 0, pendingPenalties: 0, totalDue: 0 }) === null);
check("only a licence amount is not an arrears", outstandingSummary({ licenceAmount: 100000, advanceBalance: 100000 }) === null);

console.log("\nCIAO DELIVERY SERVICES, as their org actually holds it");
{
  // Measured 15 September: 18,000 in Form 9 non-submission penalties.
  const s = outstandingSummary({
    licenceAmount: 100000,
    advanceBalance: 6149.75,
    pendingPenalties: 18000,
    pendingFines: 0,
    form9Penalties: 18000,
    renewalPenalty: 0,
    nonCompliance: 0,
    totalLevy: 93850.25,
  })!;
  check("it says something", Boolean(s));
  check("the amount is there, and readable", s.includes("AED 18,000"), s);
  check("...attributed to what it is for", /Form 9 non-submission penalties/.test(s));
  check("zero rows are not listed", !/Late renewal|Non-compliance|Pending fines/.test(s), s);
  check("the overlapping account rollup is not double-counted", (s.match(/18,000/g) ?? []).length === 1, s);
  check("the agent is told to say it BEFORE payment", /BEFORE THEY PAY/.test(s));
  check("...as EPGL's record, not our sum", /rather than as your own calculation/.test(s));
  check("...and must not total it", /Do NOT add these together/.test(s));
  check("...nor add it to the licence fee", /do NOT add them to the licence fee/.test(s));
  check("...nor call any of it the amount to pay", /do NOT present any figure as the amount they must pay/.test(s));
  check("the payable figure is named as EPGL's", /payment request they issue after the document review/.test(s));
  check("and it says why we will not do the arithmetic", /approval state/.test(s));
}

console.log("\nWhen only the account-level rollup is populated");
{
  const s = outstandingSummary({ pendingPenalties: 3000 })!;
  check("it is still stated", /AED 3,000/.test(s), s);
  check("...under a general label", /Penalties and fines outstanding/.test(s));
}

console.log("\nSeveral kinds at once are itemised, not merged");
{
  const s = outstandingSummary({ form9Penalties: 18000, renewalPenalty: 5000, nonCompliance: 100000, totalDue: 123000 })!;
  for (const [what, n] of [["Form 9", "18,000"], ["Late renewal", "5,000"], ["Non-compliance", "100,000"]] as const)
    check(`${what} listed separately`, s.includes(n), s);
  check("EPGL's own total is relayed as theirs", /Total due on the licence, EPGL's figure: AED 123,000/.test(s), s);
  check("we still refuse to add anything up", /Do NOT add these together/.test(s));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
