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
import { entityMismatch, expiredLicence, parseDocumentDate, formatGulfDate, partnerDocumentCheck } from "@/lib/docIdentity";

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

// 11. The validation sheet's person checks: owner name against the EID and
//     passport, passport number and nationality against the MOA.
{
  // Exact identifiers BLOCK -- a different passport number is a different person.
  const passport = entityMismatch({ owner_passport_no: "A13226785" }, { owner_passport_no: "Z99887766" });
  check("a different passport number blocks", passport?.severity === "block", passport);
  check("...naming the passport number", !!passport && passport.reason.includes("passport number"), passport?.reason);
  const eid = entityMismatch({ owner_emirates_id: "784198970768309" }, { owner_emirates_id: "784199983926421" });
  check("a different Emirates ID number blocks", eid?.severity === "block", eid);
  check("the same passport in another format passes",
    entityMismatch({ owner_passport_no: "A13226785" }, { owner_passport_no: "a-132 267 85" }) === null);
}

// 12. A person's NAME does not block. Transliteration is not evidence of fraud,
//     and blocking on it would repeat the MOA mistake with a person's name.
{
  const r = entityMismatch({ owner_name: "MOHAMMED AL MANSOORI" }, { owner_name: "AHMED KHALID SAEED" });
  check("a different owner name is raised", r !== null, r);
  check("...but as a question, not a block", r?.severity === "confirm", r);
  check("...and does not call the document wrong", !!r && /same person/.test(r.reason), r?.reason);
  check("a transliteration variant passes",
    entityMismatch({ owner_name: "MOHAMMED AL MANSOORI" }, { owner_name: "Mohammed Al-Mansoori" }) === null);
  check("a fuller form of the same name passes",
    entityMismatch({ owner_name: "MOHAMMED AL MANSOORI" }, { owner_name: "MOHAMMED AL MANSOORI SOLE PROPRIETORSHIP" }) === null);
}

// 13. Nationality, likewise -- "UAE" and "United Arab Emirates" are one country.
{
  check("an abbreviated nationality passes",
    entityMismatch({ owner_nationality: "UAE" }, { owner_nationality: "U.A.E." }) === null);
  const r = entityMismatch({ owner_nationality: "Indian" }, { owner_nationality: "Pakistani" });
  check("a genuinely different nationality is raised", r?.severity === "confirm", r);
}

// 14. The company check still runs when person fields are present but agree --
//     one passing check must not short-circuit the rest.
{
  const r = entityMismatch(
    { owner_passport_no: "A13226785", company_name: "YI FANG TAIWAN FRUIT TEA L.L.C" },
    { owner_passport_no: "A13226785", company_name: "AL MANSOORI GENERAL CONTRACTING L.L.C" }
  );
  check("a matching passport does not hide a company mismatch", r !== null, r);
}

// 15. A PARTNER's documents belong to a different person, and must not be
//     checked against the owner's. Without this, uploading partner 2's passport
//     blocks the application -- a different number for a genuinely different
//     person -- and every partner after the first is unreachable.
{
  const application = { owner_passport_no: "A13226785", owner_name: "MOHAMMED AL MANSOORI", owner_nationality: "UAE" };
  const partnerPassport = { owner_passport_no: "Z99887766", owner_name: "AHMED KHALID SAEED", owner_nationality: "Indian" };

  const asOwner = entityMismatch(application, partnerPassport, { documentKey: "owner_passport" });
  check("in the OWNER's slot a different passport still blocks", asOwner?.severity === "block", asOwner);

  for (const slot of ["partner_2_passport", "partner_3_emirates_id", "shareholder_2_passport", "agent_1_emirates_id"]) {
    check(`${slot} is not checked against the owner`, entityMismatch(application, partnerPassport, { documentKey: slot }) === null,
      entityMismatch(application, partnerPassport, { documentKey: slot }));
  }

  // The COMPANY is still checked on a partner slot -- a partner document that
  // names another company is still the wrong paperwork.
  const wrongCompany = entityMismatch(
    { company_name: "YI FANG TAIWAN FRUIT TEA L.L.C", trade_license_number: "CN-111" },
    { trade_license_number: "CN-222" },
    { documentKey: "partner_2_passport" }
  );
  check("a partner slot still blocks a different company's licence number", wrongCompany?.severity === "block", wrongCompany);
  check("partner_1 is not exempt by name alone", entityMismatch(application, partnerPassport, { documentKey: "partnership_deed" }) !== null);
}

// 16. THE REPORTED CASE. The MOA's shareholder table abbreviates; the Emirates
//     ID does not, and the parts are not in the same order. Neither name
//     contains the other, so containment called one man two people.
{
  const licence = { owner_name: "Abdelaziz Mohamed Obaid" };
  const eid = { owner_name: "Mohamed Abdelaziz Mohamed Balhaif Alnuaimi" };
  check("the abbreviated MOA name matches the full Emirates ID name",
    entityMismatch(licence, eid) === null, entityMismatch(licence, eid));

  // ...and the person who is genuinely someone else still does not match.
  const other = entityMismatch({ owner_name: "Faisal Eissa Lutfi Ali Hussain" }, eid);
  check("a genuinely different person is still raised", other !== null, other);

  // Nor does one shared part. Half the country is a Mohamed.
  const oneShared = entityMismatch({ owner_name: "Mohamed Saeed Khalfan" }, { owner_name: "Mohamed Abdelaziz Balhaif" });
  check("one shared name part is not a match", oneShared !== null, oneShared);

  // Two shared parts out of three is.
  check("two of three parts is a match",
    entityMismatch({ owner_name: "Ahmed Khalid Saeed" }, { owner_name: "Ahmed Khalid Saeed Al Mansoori" }) === null);
}

// 17. The same rule applied to partner slots, which is where it will bite most.
{
  const moa = { partner_1_name: "Faisal Eissa Lutfi Ali Hussain", partner_2_name: "Abdelaziz Mohamed Obaid", partner_3_name: "Valentina Mintah" };
  check("partner 2's full passport name matches the MOA's short form",
    partnerDocumentCheck("partner_2_passport", moa, { owner_name: "Mohamed Abdelaziz Mohamed Balhaif Alnuaimi" }).conflict === null);
  check("partner 1 is unaffected",
    partnerDocumentCheck("partner_1_passport", moa, { owner_name: "Faisal Eissa Lutfi Ali Hussain" }).conflict === null);
  check("partner 3 is unaffected",
    partnerDocumentCheck("partner_3_passport", moa, { owner_name: "Valentina Mintah" }).conflict === null);
  const misfiled = partnerDocumentCheck("partner_3_passport", moa, { owner_name: "Mohamed Abdelaziz Mohamed Balhaif Alnuaimi" });
  check("...and a misfile is still caught by parts", !!misfiled.conflict && /partner 2/.test(misfiled.conflict.reason), misfiled.conflict?.reason);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
