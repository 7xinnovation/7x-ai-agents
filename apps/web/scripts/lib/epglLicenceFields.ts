/**
 * The three licence fields EPGL were never sent, as a change to a definition.
 *
 * Lifted out of `epgl-licence-fields-2026-10-30.ts` so the edit can be driven
 * over a definition in a test without a database — the production database is
 * the one place it must not be rehearsed.
 *
 * See that script's header for what each change answers (LR-39149).
 */

const L = (en: string, ar: string) => ({ en, ar });

const textField = (key: string, en: string, ar: string, required = false) => ({
  key,
  type: "text",
  label: L(en, ar),
  validation: { required },
});

/**
 * REQUIRED, because the alternative to asking is sending nothing.
 *
 * Every UAE trade licence prints an issue date, so a reading that misses it is
 * a reading that went wrong — and a required field means the applicant is asked
 * for it rather than the application going to EPGL with the box empty, which is
 * the report being answered here.
 */
const ISSUE_DATE = textField(
  "license_issue_date",
  "Trade license issuance date",
  "تاريخ إصدار الرخصة التجارية",
  true
);

const TRADE_NAMES = [
  textField("trade_name_en", "Trade name (English)", "الاسم التجاري (بالإنجليزية)"),
  textField("trade_name_ar", "Trade name (Arabic)", "الاسم التجاري (بالعربية)"),
];

const GUIDANCE = `
WHAT THE TRADE LICENCE SAYS, ALL OF IT (2026-10-30 — EPGL, LR-39149). Three things came off the licence copy and never reached EPGL, and all three are printed plainly on the document.
(a) THE ISSUANCE DATE. A trade licence carries two dates side by side — Issue Date / تاريخ الإصدار and Expiry Date / تاريخ الانتهاء. Record BOTH: license_issue_date and license_expiry_date. They are never the same field and never interchangeable, and an issue date years in the past is ordinary — it is when the company was licensed, not evidence that anything has lapsed. UAE licences print dates day first, so 05/11/2013 is 5 November 2013. If the upload did not yield it, ask for it rather than submitting without it.
(b) THE TRADE NAME, EVEN WHEN IT REPEATS THE COMPANY NAME. The licence prints the registered name (Company Name / اسم الشركة) and the trade name (Trade Name or BUSINESS NAME / الاسم التجاري) one under the other, in both scripts. For most companies the two are word for word identical. Record trade_name_en and trade_name_ar anyway: identical is a fact about this company, not a reason to leave EPGL's fields blank. "Business Name" IS the trade name.
(c) THE ARABIC EXACTLY AS IT IS PRINTED. Never correct, shorten or regularise an Arabic name, and never make it agree with the English line beside it. If a name looks wrong to you, show it to the customer in the summary and let them say — do not edit it yourself.
All of these appear in the pre-submission summary, which is where the customer corrects a misreading. Never change one on your own initiative.`.trim();

const ACCOUNT_FIELDS =
  " ACCOUNT FIELDS (2026-10-30): the Account carries the company's names and licence dates, and three of them have been going out empty. Send EPG_Trade_Name_in_English__c from trade_name_en and EPG_Trade_Name_in_Arabic__c from trade_name_ar (both of them, even when they repeat Name and EPG_Company_Name_Arabic__c word for word), and EPG_Trade_license_issuance_date__c from license_issue_date as YYYY-MM-DD. EPG_Company_Name_Arabic__c is the Arabic registered name and goes exactly as it was read off the licence. The licence EXPIRY stays where it is — License_Expiry_Date__c on an issuance — and the issuance date is a different field; do not put either in the other. Omit any of these the case does not hold rather than sending an empty string. ONE FALLBACK, AND ONLY THIS ONE: EPG_Trade_Name_in_English__c and EPG_Trade_Name_in_Arabic__c are in the contract's Account schema and are safe to send, but EPG_Trade_license_issuance_date__c appears only in EPGL's read query, so it is not certain the portal may write it. If the composite comes back rejecting THAT FIELD BY NAME (INVALID_FIELD, 'not createable', 'No such column'), send the identical payload once more without it and carry on — allOrNone means nothing was created, so a retry is safe, and an applicant must not lose their licence application over a field Emirates Post may not have opened for writing. Say in the case notes that the issuance date could not be set; never show the applicant a failure for it, and never retry more than once or drop any other field this way.";

/** Every change this makes, as a line each — empty when it was already applied. */
export function applyLicenceFields(def: Record<string, any>): string[] {
  const changes: string[] = [];
  const note = (s: string) => changes.push(s);

  for (const j of def.journeys ?? []) {
    const steps: any[] = j.steps ?? [];
    const stepWith = (key: string) => steps.find((s) => (s.fields ?? []).some((f: any) => f.key === key));

    /* ── the trade names, wherever the licence details are collected ─── */
    const nameStep = stepWith("company_name_ar") ?? stepWith("trade_license_number");
    if (nameStep) {
      const have = new Set(nameStep.fields.map((f: any) => f.key));
      const missing = TRADE_NAMES.filter((f) => !have.has(f.key));
      if (missing.length) {
        const anchor = ["company_name_ar", "company_name", "trade_license_number"]
          .map((k) => nameStep.fields.findIndex((f: any) => f.key === k))
          .find((i) => i !== -1)!;
        nameStep.fields.splice(anchor + 1, 0, ...missing);
        note(`${j.key}/${nameStep.key}: +${missing.map((f) => f.key).join(", ")}`);
      }
    }

    /* ── the issuance date, on a NEW licence only ──────────────────────── */
    if (j.key === "new_license") {
      const dateStep = stepWith("license_expiry_date") ?? stepWith("trade_license_number");
      if (!dateStep) throw new Error("new_license: no step collects the licence details");
      if (!dateStep.fields.some((f: any) => f.key === ISSUE_DATE.key)) {
        const at = dateStep.fields.findIndex((f: any) => f.key === "license_expiry_date");
        // BEFORE the expiry, because that is the order they are printed in.
        dateStep.fields.splice(at === -1 ? dateStep.fields.length : at, 0, ISSUE_DATE);
        note(`${j.key}/${dateStep.key}: +license_issue_date`);
      }

      const g = String(j.guidance ?? "");
      if (!g.includes("WHAT THE TRADE LICENCE SAYS, ALL OF IT (2026-10-30")) {
        j.guidance = `${g.trimEnd()}\n\n${GUIDANCE}`;
        note(`${j.key}: guidance +${GUIDANCE.length} chars`);
      }
    }

    /* ── and the Account fields they belong in ─────────────────────────── */
    const notes = String(j.submission?.apiFlow?.notes ?? "");
    if (notes && !notes.includes("ACCOUNT FIELDS (2026-10-30)")) {
      const forJourney =
        j.key === "renewal"
          ? ACCOUNT_FIELDS.replace(
              " and EPG_Trade_license_issuance_date__c from license_issue_date as YYYY-MM-DD",
              ""
            ).replace(
              " The licence EXPIRY stays where it is — License_Expiry_Date__c on an issuance — and the issuance date is a different field; do not put either in the other.",
              " The licence expiry stays where it is on a renewal: EPG_Trade_license_Expiry_date__c."
            ).replace(/ ONE FALLBACK, AND ONLY THIS ONE: .*$/, "")
          : ACCOUNT_FIELDS;
      j.submission.apiFlow.notes = notes.trimEnd() + forJourney;
      note(`${j.key}: apiFlow notes — Account name & date fields`);
    }
  }

  return changes;
}
