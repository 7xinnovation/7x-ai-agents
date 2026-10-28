/**
 * The pack gained Arabic and must not have lost any English (28 Oct 2026).
 *
 * The documents are a regression fixture: what the extractor reads off them is
 * what the journey is tested against, so a label or a value that moved while
 * the Arabic was being added would change the test without anyone deciding to.
 * The English below is copied from the 22 October pack.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-test-pack-2026-10-28.ts
 */
import { DOCS, html, CO_AR, TRADE_AR, P1_AR, P2_AR } from "./epgl-test-pack-2026-10-28";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const doc = (file: string) => DOCS.find((d) => d.file.startsWith(file))!;
const english = (file: string) => [doc(file).titleEn, ...doc(file).rows.map((r) => r.en)].join("\n");
const arabic = (file: string) => [doc(file).titleAr, ...doc(file).rows.map((r) => r.ar)].join("\n");

check("the pack is still thirteen documents", DOCS.length === 13);
check("...with the filenames testers already have",
  DOCS.map((d) => d.file).join() ===
  ["01-trade-licence.pdf","02-memorandum-of-association.pdf","03-partner1-passport.pdf",
   "04-partner1-emirates-id.pdf","05-partner2-passport.pdf","06-partner2-emirates-id.pdf",
   "07-beneficial-ownership-declaration.pdf","08-lease-contract-ejari.pdf",
   "09-insurance-certificate-goods-in-transit.pdf","10-operational-fleet-declaration.pdf",
   "11-operational-standards-self-declaration.pdf","12-sme-licence-federal-or-local-government.pdf",
   "13-trade-licence-initial-name-approval.pdf"].join());

/** Every line the extractor is known to read, exactly as the 22 October pack printed it. */
const UNCHANGED: [string, string[]][] = [
  ["01", ["DEPARTMENT OF ECONOMIC DEVELOPMENT - DUBAI", "COMMERCIAL TRADE LICENCE",
          "Licence Number: CN-1234567", "Company Name (EN): 7X TEST - DO NOT PROCESS - 20261022A",
          "Trade Name: 7X TEST COURIER SERVICES", "Legal Form: Limited Liability Company (LLC)",
          "Issue Date: 01/01/2026", "Expiry Date: 31/12/2027", "Emirate: Dubai",
          "Registered Address: Office 101, Test Tower, Business Bay, Dubai, UAE",
          "P.O. Box: 50500", "Telephone: 00971553708434", "Email: noreply@7x.ae",
          "Owner / Manager: Ahmed Al Mansoori", "Emirates ID: 784-1990-7654321-0",
          "Nationality: United Arab Emirates"]],
  ["02", ["MEMORANDUM OF ASSOCIATION", "Share Capital: AED 300,000", "Partners:",
          "Ahmed Al Mansoori - 784-1990-7654321-0 - UAE - 51%",
          "Sara Al Hashimi   - 784-1992-1234567-3 - UAE - 49%",
          "Date of Incorporation: 01/01/2026"]],
  ["03", ["PASSPORT", "Full Name: Ahmed Al Mansoori", "Passport Number: A1234567",
          "Date of Expiry: 01/01/2034", "Place of Issue: Dubai, UAE"]],
  ["06", ["EMIRATES ID CARD", "Full Name: Sara Al Hashimi", "Emirates ID: 784-1992-1234567-3"]],
  ["07", ["BENEFICIAL OWNERSHIP DECLARATION", "Basis: Direct ownership (25% or more)",
          "Signed: Ahmed Al Mansoori, Authorised Signatory"]],
  ["08", ["EJARI TENANCY CONTRACT", "Ejari Contract Number: EJ-2026-0012345",
          "Contract Period: 01/01/2026 to 31/12/2027", "Expiry Date: 31/12/2027",
          "Annual Rent: AED 120,000"]],
  ["09", ["CERTIFICATE OF INSURANCE - GOODS IN TRANSIT", "Policy Number: GIT-7X-2026-0001",
          "Sum Insured: AED 500,000 any one consignment",
          "Period of Insurance: 01/01/2026 to 31/12/2027", "Expiry Date: 31/12/2027"]],
  ["10", ["DECLARATION AND UNDERTAKING - OPERATIONAL FLEET",
          "3 x Light Commercial Van (up to 1,500 kg payload)",
          "2 x Motorcycle (documents and small parcels)"]],
  ["11", ["OPERATIONAL STANDARDS SELF-DECLARATION",
          "Electronic shipment tracking on all consignments: YES",
          "Maximum single shipment weight: 30 kg"]],
  ["12", ["SME LICENCE", "Licence Number: SME-2026-004567",
          "Issuing Authority: Dubai SME (Mohammed Bin Rashid Establishment)",
          "Classification: Small Enterprise", "Licence Status: Active"]],
  ["13", ["INITIAL APPROVAL AND TRADE NAME RESERVATION", "Reference: INA-2026-0098765",
          "Reserved Trade Name (EN): 7X TEST COURIER SERVICES", "Valid Until: 31/12/2027"]],
];
for (const [file, lines] of UNCHANGED) {
  const text = english(file);
  const missing = lines.filter((l) => !text.includes(l));
  check(`${file}: every English line is where it was`, missing.length === 0, missing);
}

check("the two documents that must carry a readable expiry still do",
  english("08").includes("Expiry Date: 31/12/2027") && english("09").includes("Expiry Date: 31/12/2027"));
check("the DO NOT PROCESS name is on every document that named the company",
  DOCS.filter((d) => [d.titleEn, ...d.rows.map((r) => r.en)].join().includes("Company"))
      .every((d) => [d.titleEn, ...d.rows.map((r) => r.en)].join().includes("7X TEST - DO NOT PROCESS - 20261022A")));

check("every document now has an Arabic title", DOCS.every((d) => /[؀-ۿ]/.test(d.titleAr)));
check("...and Arabic on every line that has English",
  DOCS.every((d) => d.rows.every((r) => r.en === "" || /[؀-ۿ0-9]/.test(r.ar))));
check("the company's Arabic name is the one the case already holds",
  CO_AR === "اختبار 7X - لا تقم بالمعالجة - 20261022A");
check("the trade licence carries both company names", (() => {
  const t = [doc("01").titleEn, ...doc("01").rows.map((r) => `${r.en}|${r.ar}`)].join("\n");
  return t.includes("Company Name (EN): 7X TEST - DO NOT PROCESS - 20261022A") && t.includes(CO_AR);
})());
check("the trade name has an Arabic form", /[؀-ۿ]/.test(TRADE_AR));
check("...and it is on the licence and the name reservation",
  arabic("01").includes(TRADE_AR) && arabic("13").includes(TRADE_AR));
check("both partners have Arabic names", /[؀-ۿ]/.test(P1_AR) && /[؀-ۿ]/.test(P2_AR));
check("...on their own identity documents",
  arabic("03").includes(P1_AR) && arabic("04").includes(P1_AR) &&
  arabic("05").includes(P2_AR) && arabic("06").includes(P2_AR));
check("the licence number is identical in both columns of every document", (() => {
  for (const d of DOCS) {
    const en = d.rows.map((r) => r.en).join("\n");
    const ar = d.rows.map((r) => r.ar).join("\n");
    if (en.includes("CN-1234567") !== ar.includes("CN-1234567")) return false;
  }
  return true;
})());

const page = html(doc("01"));
check("the rendered page declares its encoding", /<meta charset="utf-8">/.test(page));
check("...marks the Arabic column right-to-left", /dir="rtl" lang="ar"/.test(page));
check("...and asks for a font that actually has Arabic glyphs", /"Geeza Pro"/.test(page));
check("the page is one A4 sheet's worth of markup, not a document generator",
  /@page \{ size: A4/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
