/**
 * The three EPGL reported on LR-39149 (30 October 2026).
 *
 * Two of them are a definition: a field that does not exist cannot be read off
 * a document, and a Salesforce field nobody names does not get sent. Those are
 * driven here over a 1.x definition shaped like the one in production, built
 * deliberately BEHIND — without the trade-name fields — because a database
 * several rounds behind the repository is the normal case, and a fix that only
 * works on an up-to-date one fixes nothing.
 *
 * The third is the Arabic name, and it is the extractor's prompt. There is no
 * deterministic half of that to assert, so what is pinned is that the rule is
 * still there: it is the only thing standing between Dubai DET's broken text
 * layer and a company name that belongs to nobody.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-licence-fields-2026-10-30.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyLicenceFields } from "./lib/epglLicenceFields";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : (extra ?? ""));
  ok ? pass++ : fail++;
};

const f = (key: string) => ({ key, type: "text", label: { en: key }, validation: { required: true } });

/** Production as it may well be: 1.x, and without the 11 September names. */
const behind = () => ({
  journeys: [
    {
      key: "new_license",
      guidance: "ISSUANCE GUIDANCE.",
      steps: [
        {
          key: "company_details",
          fields: [f("company_name"), f("company_name_ar"), f("trade_license_number"), f("license_expiry_date"), f("regulator")],
          documents: [],
        },
      ],
      submission: { apiFlow: { notes: "Build ONE atomic composite payload … License_Expiry_Date__c, RecordTypeId 0125f000001xIheAAE." } },
    },
    {
      key: "renewal",
      guidance: "RENEWAL GUIDANCE.",
      steps: [{ key: "license_review", fields: [f("trade_license_number"), f("license_expiry_date")], documents: [] }],
      submission: { apiFlow: { notes: "Renewal composite …" } },
    },
  ],
});

const fieldsOf = (def: any, journey: string, step: string): string[] =>
  def.journeys.find((j: any) => j.key === journey).steps.find((s: any) => s.key === step).fields.map((x: any) => x.key);
const journey = (def: any, key: string) => def.journeys.find((j: any) => j.key === key);

// ── a definition that is behind gets all of it ────────────────────────────────
{
  const def = behind();
  const changes = applyLicenceFields(def);
  check("a definition missing everything is changed", changes.length > 0, changes);

  const company = fieldsOf(def, "new_license", "company_details");
  check("the issuance date now exists", company.includes("license_issue_date"), company);
  check("...beside the expiry, in the order the licence prints them",
    company.indexOf("license_issue_date") === company.indexOf("license_expiry_date") - 1, company);
  /**
   * Required on purpose. The alternative to asking the applicant is sending
   * EPGL an empty box, which is the report this answers.
   */
  const issue = journey(def, "new_license").steps[0].fields.find((x: any) => x.key === "license_issue_date");
  check("and it is required, so an unread date is asked for rather than skipped", issue.validation.required === true, issue);
  check("it is labelled in both languages", Boolean(issue.label.en && issue.label.ar), issue.label);

  check("the trade names now exist too", company.includes("trade_name_en") && company.includes("trade_name_ar"), company);
  check("...next to the company name they are so often identical to",
    company.indexOf("trade_name_en") === company.indexOf("company_name_ar") + 1, company);
  check("the trade licence number was not displaced", company.includes("trade_license_number"));
  check("nothing that was there was removed",
    ["company_name", "company_name_ar", "trade_license_number", "license_expiry_date", "regulator"].every((k) => company.includes(k)), company);

  // ── the Salesforce side ────────────────────────────────────────────────────
  const notes = journey(def, "new_license").submission.apiFlow.notes;
  for (const field of ["EPG_Trade_Name_in_English__c", "EPG_Trade_Name_in_Arabic__c", "EPG_Trade_license_issuance_date__c", "EPG_Company_Name_Arabic__c"])
    check(`the issuance notes name ${field}`, notes.includes(field));
  check("...and say the identical-to-the-company-name case is still sent", /even when they repeat/.test(notes));
  check("...and keep the expiry where it already was", notes.includes("License_Expiry_Date__c"));
  check("...without discarding the notes that were there", notes.startsWith("Build ONE atomic composite payload"));
  /**
   * The issuance date is the one field here that is not in the contract's
   * Account write schema — it appears only in EPGL's read query. The composite
   * is allOrNone, so a field they have not opened for writing would roll back
   * the whole application. Hence one retry without it, and no other.
   */
  check("...and say what to do if EPGL will not accept the issuance date", /ONE FALLBACK, AND ONLY THIS ONE/.test(notes));
  check("...and say it was tested rather than guessed at", /tested on epro--preprod2 on 30 October 2026/.test(notes));
  check("...and never call the field doubtful again", !/not certain the portal may write it/.test(notes));
  check("...which is to send it again once without that field", /send the identical payload once more without it/.test(notes));
  check("...never more than once, and never any other field", /never retry more than once or drop any other field/.test(notes));
  check("...and never as a failure the applicant sees", /never show the applicant a failure for it/.test(notes));

  const guidance = journey(def, "new_license").guidance;
  check("the guidance tells the agent to read both dates", /Issue Date .* Expiry Date/.test(guidance));
  check("...and that Business Name IS the trade name", /"Business Name" IS the trade name/.test(guidance));
  check("...and never to correct an Arabic name itself", /Never correct, shorten or regularise an Arabic name/.test(guidance));
  check("...appended, not replacing what was there", guidance.startsWith("ISSUANCE GUIDANCE."));
}

// ── a renewal is not an issuance ──────────────────────────────────────────────
/**
 * EPGL's own contract: "Only EPG_Trade_license_no__c,
 * EPG_Trade_license_Expiry_date__c, EPG_Trade_Name_in_English__c,
 * EPG_Trade_Name_in_Arabic__c are editable on the portal." Sending an issuance
 * date on a renewal is sending a field they do not accept, into the one call
 * that rolls the whole thing back when an item fails.
 */
{
  const def = behind();
  applyLicenceFields(def);
  const review = fieldsOf(def, "renewal", "license_review");
  check("a renewal never collects an issuance date", !review.includes("license_issue_date"), review);
  check("but it does get the trade names, which ARE editable on a renewal",
    review.includes("trade_name_en") && review.includes("trade_name_ar"), review);
  const notes = journey(def, "renewal").submission.apiFlow.notes;
  check("and its notes never mention the issuance date field", !notes.includes("EPG_Trade_license_issuance_date__c"), notes.slice(-200));
  check("...nor carry a fallback for a field it never sends", !notes.includes("ONE FALLBACK"), notes.slice(-200));
  check("...and name the renewal's own expiry field", notes.includes("EPG_Trade_license_Expiry_date__c"));
  check("the renewal guidance is left alone", journey(def, "renewal").guidance === "RENEWAL GUIDANCE.");
}

// ── a definition carrying yesterday's wording is repaired, not left ───────────
/**
 * The 30 October block went to production saying the issuance date might not
 * be writable. It is — tested against epro--preprod2 the same day, their
 * handler forwards it. The marker is already in those notes, so a plain re-run
 * would leave the doubt in place forever; this is the repair that doesn't.
 */
{
  const def = behind();
  const j = journey(def, "new_license");
  j.submission.apiFlow.notes =
    "Build ONE atomic composite payload … ACCOUNT FIELDS (2026-10-30): … EPG_Trade_license_issuance_date__c " +
    "appears only in EPGL's read query, so it is not certain the portal may write it. More text after.";
  const changes = applyLicenceFields(def);
  const notes = j.submission.apiFlow.notes;
  check("the stale sentence is gone", !notes.includes("not certain the portal may write it"), notes);
  check("...replaced by what was actually measured", /their handler DOES forward it/.test(notes), notes);
  check("...and the rest of the sentence is untouched", notes.endsWith("More text after."), notes.slice(-40));
  check("...and the repair is reported", changes.some((c) => /writable, tested, not doubtful/.test(c)), changes);
  const again = applyLicenceFields(def);
  check("...and does not repeat itself", !again.some((c) => /writable, tested/.test(c)), again);
}

// ── and it knows a 2.0 journey when it sees one ───────────────────────────────
/**
 * EPGL 2.0 posts handler aliases to an Apex CompositeHandler, not an Account.
 * Writing `EPG_Trade_Name_in_English__c` into those notes would be field names
 * from the wrong contract, in the one place that builds the payload.
 */
{
  const def = behind();
  const j = journey(def, "new_license");
  j.submission.apiFlow = {
    service: "EPGL New Regulation",
    saveTool: "epgl_new_regulation__post_services_apexrest_CompositeHandler",
    notes: "One Apex REST surface. Read the catalogue …",
  };
  applyLicenceFields(def);
  const notes = j.submission.apiFlow.notes;
  check("a 2.0 journey's notes are not given 1.x Account fields", !notes.includes("EPG_Trade_Name_in_English__c"), notes);
  check("...and are left exactly as they were", notes === "One Apex REST surface. Read the catalogue …");
  check("...and the skip is reported rather than silent",
    applyLicenceFields(behind2()).some((c) => /EPGL 2\.0/.test(c)));
  // The FIELDS still go in — a 2.0 journey reads a licence the same way.
  check("but the fields it reads off the licence still go in",
    fieldsOf(def, "new_license", "company_details").includes("license_issue_date"));
}
function behind2() {
  const d = behind();
  journey(d, "new_license").submission.apiFlow = { service: "EPGL New Regulation", notes: "x" };
  return d;
}

// ── and running it twice does nothing the second time ─────────────────────────
{
  const def = behind();
  applyLicenceFields(def);
  const once = JSON.stringify(def);
  const again = applyLicenceFields(def);
  check("a second run reports no change", again.length === 0, again);
  check("...and changes nothing", JSON.stringify(def) === once);
}

// ── a definition that is already current is untouched ─────────────────────────
{
  const def = behind();
  const cur = journey(def, "new_license").steps[0];
  cur.fields.splice(2, 0, f("trade_name_en"), f("trade_name_ar"));
  const changes = applyLicenceFields(def);
  check("a step that already has the trade names does not get them again",
    !changes.some((c) => c.startsWith("new_license/") && c.includes("trade_name_en")), changes);
  check("...while the step that lacks them still does", changes.some((c) => c.startsWith("renewal/") && c.includes("trade_name_en")), changes);
  check("...and does not end up with two of anything",
    new Set(fieldsOf(def, "new_license", "company_details")).size === fieldsOf(def, "new_license", "company_details").length);
}

// ── the rule that answers the Arabic name ─────────────────────────────────────
/**
 * `pdftotext` on the licence EPGL tested with returns
 * "اي فانغ تايوان فروت للشاي" where the page shows
 * "اي فانغ تايوان فروتي للشاي" — the file's own text layer is wrong, and it is
 * wrong the same way throughout (الاسم → السم, الإصدار → الصدار). The model is
 * given both the text layer and the rendered page; this is what tells it which
 * one to believe, and without it the next licence loses a letter too.
 */
{
  const extract = readFileSync(
    fileURLToPath(new URL("../../../packages/core/src/ai/extract.ts", import.meta.url)),
    "utf8"
  );
  check("the extractor is told to read Arabic off the rendered page", extract.includes("READ ARABIC OFF THE PAGE"));
  check("...and which of the two wins when they disagree", /the rendering is right/.test(extract));
  check("...and names the letters Dubai DET drops", /lam-alef/.test(extract) && /word-final/.test(extract));
  check("the trade name is claimed even when it repeats the company name", extract.includes("THE TRADE NAME IS ITS OWN FIELD"));
  check("...and Business Name is named as the heading it hides behind", /BUSINESS NAME/.test(extract));
  check("an issue date and an expiry date are kept apart", extract.includes("TWO DATES AND THEY ARE NOT INTERCHANGEABLE"));
  check("...and an old issue date is not read as a lapse", /not evidence that anything has lapsed/.test(extract));
  check("dates are read day first", /read UAE documents DAY FIRST/.test(extract));
  check("...with the example that decides it", extract.includes("05/11/2013 was issued on 2013-11-05"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
