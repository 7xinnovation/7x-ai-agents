/**
 * The case type and the reference Emirates Post can actually look up (26 Oct).
 *
 * Two bugs from one complaint, reported the same morning.
 *
 * A tester went through the COMPLAINT flow, was told "Your complaint has been
 * raised", and wrote only "Testing - 0544043558 -Farah -6005 ajm". There is no
 * complaint word in that, so the classifier called it an Inquiry and Emirates
 * Post's console numbered it INQ-01267121. The model knew what it was — it had
 * no way to say so, which is what `case_type` on the tool fixes.
 *
 * And the reference we gave was 01601318, which their agents could not find,
 * because their CRM answers with BOTH numbers and we took the wrong one:
 *
 *   {"customCaseNumber":"INQ-00000179","caseNumber":"01246852", ...}
 *
 * `customCaseNumber` is their "Case Numbering" — the one a person searches on.
 *
 * Run from apps/web:  npx tsx scripts/test-case-type-and-reference-2026-10-26.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { caseIntakeFrom, caseTypeFrom } from "@dialog/core";
import { caseNumberFrom } from "@/lib/epCase";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, "..", p), "utf8");

// ---- the reference their agents search on -----------------------------------
const REAL = JSON.stringify({
  success: true, operation: "CASE_INSERTED", message: "Case inserted successfully.",
  errors: null, customCaseNumber: "INQ-00000179", caseNumber: "01246852", caseId: "500FV00Lp4AM9LkYEL",
});
check("their customer-facing number is the one we quote", caseNumberFrom(REAL) === "INQ-00000179");
check("...not the Salesforce one beside it", caseNumberFrom(REAL) !== "01246852");
check("a complaint's CO- number is taken the same way",
  caseNumberFrom(JSON.stringify({ customCaseNumber: "CO-00000144", caseNumber: "01246853" })) === "CO-00000144");
check("the website form's shape still works when that is all there is",
  caseNumberFrom(JSON.stringify({ caseNumbering: "01246847" })) === "01246847");
check("...and a bare caseNumber still works", caseNumberFrom(JSON.stringify({ caseNumber: "01246852" })) === "01246852");
check("it is preferred inside an envelope too",
  caseNumberFrom(JSON.stringify({ data: { customCaseNumber: "INQ-1", caseNumber: "9" } })) === "INQ-1");
check("a top-level customer number beats a nested internal one",
  caseNumberFrom(JSON.stringify({ customCaseNumber: "INQ-2", data: { caseNumber: "9" } })) === "INQ-2");
check("underscores and casing do not matter",
  caseNumberFrom(JSON.stringify({ Custom_Case_Number: "INQ-3" })) === "INQ-3");
check("nothing recognisable gives nothing, never an invention",
  caseNumberFrom(JSON.stringify({ success: true, caseId: "500xx" })) === "");
check("nonsense gives nothing rather than throwing", caseNumberFrom("not json") === "");

// ---- the type, from the conversation ----------------------------------------
// THE REPORTED CASE, exactly as it happened.
const TESTER = "Testing - 0544043558 -Farah -6005 ajm";
check("the reported message still reads as an Inquiry on its words alone",
  caseTypeFrom(TESTER) === "Inquiry");
check("...but the assistant saying Complaint settles it",
  caseIntakeFrom(TESTER, {}, "Complaint").caseType === "Complaint");
check("a stated Feedback is honoured", caseIntakeFrom(TESTER, {}, "Feedback").caseType === "Feedback");
check("a stated Compliment is honoured", caseIntakeFrom(TESTER, {}, "Compliment").caseType === "Compliment");
check("a stated Inquiry is honoured", caseIntakeFrom("my parcel is lost", {}, "Inquiry").caseType === "Inquiry");
check("casing and spacing do not matter", caseIntakeFrom(TESTER, {}, "  complaint ").caseType === "Complaint");
check("a value that is not one of theirs falls back to the words",
  caseIntakeFrom("my parcel never arrived", {}, "Urgent").caseType === "Complaint");
check("...and to Inquiry when the words say nothing",
  caseIntakeFrom(TESTER, {}, "Urgent").caseType === "Inquiry");
check("saying nothing still reads the words", caseIntakeFrom("my parcel was damaged", {}).caseType === "Complaint");
check("the other intake fields are untouched by this",
  caseIntakeFrom("box 6005 in ajman", {}, "Complaint").emirateCode === "AJM");

// ---- wiring -----------------------------------------------------------------
const tools = read("../../packages/core/src/ai/tools.ts");
check("the tool offers their four types and only those",
  /enum: \["Inquiry", "Complaint", "Feedback", "Compliment"\]/.test(tools));
check("a complaint flow decides it even when the words are flat",
  /that choice decides it/.test(tools));
check("what the model says is passed to the intake", /input\.case_type as string \| undefined/.test(tools));
check("the description tells it to set one", /Set case_type to what this actually is/.test(tools));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
