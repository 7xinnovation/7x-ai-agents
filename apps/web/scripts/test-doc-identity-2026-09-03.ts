/**
 * Document identity + licence expiry (2026-09-03).
 *
 * The reported glitch, verbatim: a customer uploaded the MOA for YIFANG CAFE
 * MIDDLE EAST L.L.C against an application reading YI FANG TAIWAN FRUIT TEA
 * L.L.C and was told it was another company's document. Both are correct -- in
 * the UAE the registered name and the trade name are different strings on
 * different documents, and we were comparing one against the other.
 *
 * Also covers the new rule: an expired trade licence stops the application.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-doc-identity-2026-09-03.ts
 */
import { entityMismatch, expiredLicence, parseDocumentDate, formatGulfDate } from "@/lib/docIdentity";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

// 1. THE REPORTED CASE. The application holds the trade name; the MOA carries
//    the registered name. It must be accepted.
{
  const application = { company_name: "YI FANG TAIWAN FRUIT TEA L.L.C" };
  const moa = { company_name: "YIFANG CAFE MIDDLE EAST L.L.C" };
  const r = entityMismatch(application, moa);
  // Not blocked: from strings alone, a registered name beside a trade name is
  // indistinguishable from a wrong company, and refusing guessed wrong here.
  check("the reported MOA is no longer refused", r?.severity !== "block", r);
  check("...the customer is asked instead", r?.severity === "confirm", r);
  check("...and the wording does not call the document wrong",
    !!r && !/does not match/.test(r.reason) && /registered name/.test(r.reason), r?.reason);
  // With the registered name recorded where it belongs, the two agree outright.
  check("...and agrees when the registered name is on file", entityMismatch(
    { company_name: "YIFANG CAFE MIDDLE EAST L.L.C", trade_name_en: "YI FANG TAIWAN FRUIT TEA L.L.C" },
    moa
  ) === null);
}

// 2. A matching trade licence NUMBER settles it. Names are a spelling exercise;
//    the number is an identifier.
{
  const application = { company_name: "YI FANG TAIWAN FRUIT TEA L.L.C", trade_license_number: "CN-1234567" };
  const moa = { company_name: "YIFANG CAFE MIDDLE EAST L.L.C", trade_license_number: "cn1234567" };
  check("a matching licence number accepts any name", entityMismatch(application, moa) === null, entityMismatch(application, moa));
}

// 3. A genuinely different company is still refused -- the client's sheet wants
//    that to stop the application, and it does.
{
  const application = { company_name: "YI FANG TAIWAN FRUIT TEA L.L.C" };
  const other = { company_name: "AL MANSOORI GENERAL CONTRACTING L.L.C" };
  const r = entityMismatch(application, other);
  // Still surfaced, still stops the flow until answered -- but as a question,
  // because two unrelated names and a trade-vs-registered pair look the same.
  check("a different company is raised", r !== null, r);
  check("...and the reason names both", !!r && r.reason.includes("AL MANSOORI") && r.reason.includes("YI FANG"), r);
}

// 4. A mismatched licence number is refused even when the names agree -- two
//    branches of one group share a name and are separate licences.
{
  const r = entityMismatch(
    { company_name: "AL MANSOORI L.L.C", trade_license_number: "CN-111" },
    { company_name: "AL MANSOORI L.L.C", trade_license_number: "CN-222" }
  );
  check("a mismatched licence number BLOCKS", r?.severity === "block", r);
  check("...naming the number, not the company", !!r && r.reason.includes("trade licence number"), r);
}

// 5. Spelling and legal form must not decide anything.
{
  const same = [
    ["YIFANG CAFE MIDDLE EAST L.L.C", "Yi Fang Cafe Middle East LLC"],
    ["GULF SYSTEM INTERNATIONAL SHIPPING GFS L.L.C", "gulf system international shipping gfs"],
    ["AL NOOR TRADING EST", "Al-Noor Trading Establishment"],
  ] as const;
  for (const [a, b] of same) {
    check(`same company either way: ${a.slice(0, 22)}…`, entityMismatch({ company_name: a }, { company_name: b }) === null);
  }
}

// 6. Nothing to compare is not a mismatch. The first document of an application
//    has nothing to contradict, and refusing it would stall every journey.
{
  check("no name on the application", entityMismatch({}, { company_name: "ANYTHING L.L.C" }) === null);
  check("no name on the document", entityMismatch({ company_name: "ANYTHING L.L.C" }, {}) === null);
  check("neither side", entityMismatch({}, {}) === null);
  check("a one-character name is ignored, not matched", entityMismatch({ company_name: "A" }, { company_name: "B" }) === null);
}

// 7. Arabic names compare on their own terms.
{
  check("matching Arabic names pass", entityMismatch(
    { company_name_ar: "شركة يي فانغ الشرق الأوسط" },
    { company_name_ar: "شركة يي فانغ الشرق الأوسط ذ.م.م" }
  ) === null);
  check("different Arabic names are raised",
    entityMismatch({ company_name_ar: "شركة النور للتجارة" }, { company_name_ar: "مؤسسة الخليج للشحن" }) !== null);
}

// 8. Dates off documents. UAE paperwork is DD/MM/YYYY.
{
  const d = parseDocumentDate("03/09/2026");
  check("03/09/2026 is 3 September", !!d && d.getUTCMonth() === 8 && d.getUTCDate() === 3, d?.toISOString());
  const iso = parseDocumentDate("2026-09-03");
  check("ISO is accepted", !!iso && iso.getUTCMonth() === 8 && iso.getUTCDate() === 3, iso?.toISOString());
  const us = parseDocumentDate("09/25/2026");
  check("an impossible month is read as MM/DD", !!us && us.getUTCMonth() === 8 && us.getUTCDate() === 25, us?.toISOString());
  check("nonsense is null, not a guess", parseDocumentDate("sometime next year") === null);
  check("an impossible date is null", parseDocumentDate("31/02/2026") === null);
  check("empty is null", parseDocumentDate("") === null);
  check("formatting round-trips", formatGulfDate(parseDocumentDate("03/09/2026")!) === "03/09/2026");
}

// 9. Expired licences stop the application; a licence expiring TODAY does not.
{
  const now = new Date("2026-09-03T06:00:00Z"); // 10:00 in the UAE
  check("expired yesterday is refused", expiredLicence({ trade_license_expiry: "02/09/2026" }, now) !== null);
  check("expiring today is still valid", expiredLicence({ trade_license_expiry: "03/09/2026" }, now) === null);
  check("expiring tomorrow is valid", expiredLicence({ trade_license_expiry: "04/09/2026" }, now) === null);
  check("no expiry stated is not expired", expiredLicence({}, now) === null);
  check("an unparseable expiry is not expired", expiredLicence({ trade_license_expiry: "n/a" }, now) === null);
  check("the alternative field name is read", expiredLicence({ license_expiry_date: "01/01/2020" }, now) !== null);
  const r = expiredLicence({ trade_license_expiry: "02/09/2026" }, now);
  check("the date is reported back", !!r && formatGulfDate(r.expiredOn) === "02/09/2026", r);
}

// 10. Late on the last day, UAE time. A UTC comparison would expire the licence
//     four hours early and refuse a customer whose licence is valid until midnight.
{
  const lateGulf = new Date("2026-09-03T20:30:00Z"); // 00:30 on 4 Sep in the UAE
  check("just past midnight in the UAE, yesterday's licence is expired",
    expiredLicence({ trade_license_expiry: "03/09/2026" }, lateGulf) !== null);
  const earlyGulf = new Date("2026-09-03T19:30:00Z"); // 23:30 on 3 Sep in the UAE
  check("half an hour earlier it is still valid",
    expiredLicence({ trade_license_expiry: "03/09/2026" }, earlyGulf) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
