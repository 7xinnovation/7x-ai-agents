/**
 * The quarterly figures have never once reached Salesforce.
 *
 * Measured on their org, 15 September: five renewals submitted by this agent,
 * every one at "Under document review" with all four mandatory flags true and an
 * accountant contact on the account — and EPG_Finance_Summary__c rows in the
 * WHOLE ORG: zero. Not rejected: allOrNone would have rolled the licence request
 * back with them, and the requests exist. They were never sent.
 *
 * The instructions were complete and had been since 11 August. They were left to
 * the model, and the model did not emit them, so the entire financial summary the
 * renewal collects went nowhere.
 *
 * Run from apps/web:  npx tsx scripts/test-renewal-finance-rows-2026-09-15.ts
 */
import { withEpglRequestFields, financePeriod } from "../lib/integrations";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const composite = (extra: Record<string, unknown>[] = []) => ({
  body: {
    allOrNone: true,
    isAgentSource: true,
    compositeRequest: [
      { method: "POST", referenceId: "NewAccount", url: "/services/data/v66.0/sobjects/Account", body: { Name: "X" } },
      { method: "POST", referenceId: "NewLicenseRequest", url: "/services/data/v66.0/sobjects/EPG_License_Request__c", body: { RecordTypeId: "0125f000001xIhwAAE" } },
      ...extra,
    ],
  },
});
const FACTS = {
  financeQuarters: [100000, 120000, 90000, 80000],
  financeStartQuarter: "Q3",
  financeYear: "2023",
  licenceRecordId: "a0S5f000000AbCdEAA",
};
const rowsOf = (out: unknown) =>
  (((out as { body?: { compositeRequest?: Record<string, unknown>[] } })?.body?.compositeRequest ?? [])
    .find((i) => /EPG_Finance_Summary__c$/.test(String(i.url ?? "")))?.body ?? []) as Record<string, unknown>[];

console.log("\nThe period is walked, not numbered");
{
  // The guidance's own worked example: start Q3 2023.
  const p = financePeriod("Q3", "2023");
  check("four quarters from where the period starts", p.map((x) => `${x.quarter} ${x.year}`).join(", ") === "Q3 2023, Q4 2023, Q1 2024, Q2 2024", p);
  check("a period starting Q1 stays in its year", financePeriod("Q1", "2025").map((x) => `${x.quarter} ${x.year}`).join(", ") === "Q1 2025, Q2 2025, Q3 2025, Q4 2025");
  check("Q4 rolls three quarters into the next year", financePeriod("Q4", "2024").map((x) => `${x.quarter} ${x.year}`).join(", ") === "Q4 2024, Q1 2025, Q2 2025, Q3 2025");
  check("nonsense yields nothing rather than a guess", financePeriod("Q9", "2024").length === 0 && financePeriod("Q1", "nope").length === 0);
}

console.log("\nThe rows are built");
{
  const rows = rowsOf(withEpglRequestFields(composite(), FACTS));
  check("one per quarter", rows.length === 4, rows.length);
  check("the real calendar quarter, not the field order", rows.map((r) => `${r.Quarter__c} ${r.EPG_Year__c}`).join(", ") === "Q3 2023, Q4 2023, Q1 2024, Q2 2024", rows.map((r) => r.Name));
  check("the name matches the quarter", rows[0]!.Name === "Q3 2023");
  check("the figures land in period order", rows.map((r) => r.EPG_Leviable_Income__c).join(",") === "100000,120000,90000,80000");
  check("non-leviable is stated, not omitted", rows.every((r) => r.EPG_Non_Leviable_Income__c === 0));
  check("each row references the licence request", rows.every((r) => r.EPG_License_Request__c === "@{NewLicenseRequest.id}"));
  check("...and carries the licence RECORD id", rows.every((r) => r.EPG_License_No__c === "a0S5f000000AbCdEAA"));
}

console.log("\nWhat it must not do");
{
  // No upsert key in their handler: a row beside the model's is a duplicate
  // nobody can remove.
  const already = [{ method: "POST", referenceId: "NewTrialBalance", url: "/services/data/v66.0/sobjects/EPG_Finance_Summary__c", body: [{ Quarter__c: "Q1" }] }];
  const out = withEpglRequestFields(composite(already), FACTS);
  check("nothing is added when the model already sent some", rowsOf(out).length === 1, rowsOf(out));

  check("no figures, no rows", rowsOf(withEpglRequestFields(composite(), { ...FACTS, financeQuarters: [null, null, null, null] })).length === 0);
  check("no start quarter, no rows", rowsOf(withEpglRequestFields(composite(), { ...FACTS, financeStartQuarter: undefined })).length === 0);
  check("no year, no rows", rowsOf(withEpglRequestFields(composite(), { ...FACTS, financeYear: undefined })).length === 0);
  // A new licence has no licence request of the renewal kind and no figures.
  check("a submission with no figures is untouched", rowsOf(withEpglRequestFields(composite(), { emirate: "Dubai" })).length === 0);
  // A quarter the customer genuinely left blank is skipped, not sent as zero.
  const partial = rowsOf(withEpglRequestFields(composite(), { ...FACTS, financeQuarters: [100000, null, 90000, null] }));
  check("a blank quarter is skipped, not sent as zero", partial.length === 2 && partial.map((r) => r.Quarter__c).join() === "Q3,Q1", partial.map((r) => `${r.Quarter__c} ${r.EPG_Leviable_Income__c}`));
  check("the licence id is omitted rather than faked when unknown", rowsOf(withEpglRequestFields(composite(), { ...FACTS, licenceRecordId: undefined })).every((r) => r.EPG_License_No__c === undefined));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
