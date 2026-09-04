/**
 * The IDEP wrapper's real responses (2026-09-04).
 *
 * Every fixture below is a VERBATIM excerpt of what api-stg.epgl.ae returned on
 * 4 Sep 2026, not a reconstruction from documentation. The last version of this
 * parser was written against MOEc's published sample and the live shapes differ
 * in ways that would each have failed silently:
 *
 *   - field names are lowercase-first (bnRegNameEn, bnBranchFlag, managers)
 *   - by-owner returns an ARRAY, by-ern a single OBJECT
 *   - statusCode is 101, not 100, and 101 is a SUCCESS
 *   - absent values are placeholders: "-", "not applicable", "None"
 *   - only by-ern carries owners; by-owner never does
 *
 * Run from apps/web:
 *   npx tsx scripts/test-moe-wrapper-2026-09-04.ts
 */
import { parseMoeResponse, mapLicence, ownerMatch, licenceHolderMatch, normaliseEmiratesId } from "@/lib/moeLicences";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

/** licenses-by-owner, verbatim. Note statusCode 101 and managers: null. */
const BY_OWNER = {
  getLicenseDetailsByOwnerID_Response: {
    licenseInfo: [
      {
        licenseDetails: {
          licenseERN: "1020000000CN1022545",
          licenseLocalID: "CN-1022545",
          licenseIssuanceEDID: 1,
          bnRegNameAr: "النجمة لكفاءة التقنية للتجارة - ذ م م",
          bnRegNameEn: "STAR TECHNOFIT TRADING - L L C",
          licenseRegistrationDate: "1997-08-07 00:00:00",
          licenseExpirationDate: "2024-08-29 00:00:00",
          licenseStatusID: "MOECID7",
          licenseLegalTypeID: "MOECID3",
          licenseAddrEmirate: "1",
          licenseMobPhoneNo: "00971569489047",
          licenseOfficialEmail: "startechnofittra@gmail.com",
          licenseLegalRepresentativeName: null,
          isLicenseListedinUAEExchanges: false,
          bnBranchFlag: false,
        },
        licenseActivities: {
          licenseActivity: [
            { activityCode: "4610008", activityNameEN: "Importing", activityNameAR: "استيراد", activityStartDate: "1997-07-08 00:00:00" },
          ],
        },
        managers: null,
      },
      {
        licenseDetails: { licenseERN: "1020000000CN2649312", licenseLocalID: "CN-2649312", bnRegNameEn: "BLACK BOX TECHNOLOGIES    L.L.C.", bnBranchFlag: false },
      },
    ],
    statusMessages: [
      { statusCode: "101", statusDescriptionEN: "Success (Only license information is fetched, Personal details are not retrieved as it needs a prior consent)" },
    ],
  },
};

/** license-details-by-ern, verbatim. licenseInfo is an OBJECT and HAS owners. */
const BY_ERN = {
  getLicenseDetails_Response: {
    licenseInfo: {
      licenseDetails: {
        licenseERN: "1020000000CN2649312",
        licenseLocalID: "CN-2649312",
        licenseIssuanceEDID: 1,
        bnRegNameAr: "بلاك بوكس للتكنولوجيا ذ.م.م",
        bnRegNameEn: "BLACK BOX TECHNOLOGIES    L.L.C.",
        licenseExpirationDate: "2024-03-09 00:00:00",
        licenseStatusID: "MOECID7",
        bnBranchFlag: false,
      },
      owners: {
        personDetails: [
          {
            personFullNameAR: "هادف صلاح سالم عمير الشامسى",
            personFullNameEN: "-",
            personMobileNo: "0504459100",
            personNationality: "MOECID222",
            personEmail: "not applicable",
            personEmiratesID: "784198687965412",
            personPassportNo: "GFY266300",
            personHomeCountryIDNumber: "Not Applicable",
          },
        ],
      },
      managers: null,
    },
    statusMessages: [{ statusCode: "100", statusDescriptionEN: "Success" }],
  },
};

// 1. by-owner: an array of six in life, two here, parsed as licences.
{
  const r = parseMoeResponse(BY_OWNER);
  check("both licences parsed", r.licences.length === 2, r.licences.length);
  check("statusCode 101 read", r.statusCode === "101", r.statusCode);
  const l = r.licences[0]!;
  check("lowercase bnRegNameEn", l.nameEn === "STAR TECHNOFIT TRADING - L L C", l.nameEn);
  check("lowercase bnRegNameAr", (l.nameAr ?? "").startsWith("النجمة"), l.nameAr);
  check("licenceLocalID is the trade licence number", l.tradeLicenseNo === "CN-1022545", l.tradeLicenseNo);
  check("numeric issuing entity stringified", l.issuingEntityCode === "1", l.issuingEntityCode);
  check("expiry", l.expiryDate === "2024-08-29 00:00:00", l.expiryDate);
  check("activity", l.activities[0]?.nameEn === "Importing", l.activities);
  check("MOEc codes kept raw", l.statusCodeRaw === "MOECID7" && l.emirateCodeRaw === "1", l);
}

// 2. THE STATUS TRAP. 101 is a success -- an earlier version threw on anything
//    but 100, which would have reported a real customer's licences as an error.
{
  const empty = { getLicenseDetailsByOwnerID_Response: { licenseInfo: [], statusMessages: [{ statusCode: "101" }] } };
  const r = parseMoeResponse(empty);
  check("101 with nothing is still a valid empty answer", r.statusCode === "101" && r.licences.length === 0 && r.rawCount === 0);
  const bad = parseMoeResponse({ getLicenseDetailsByOwnerID_Response: { licenseInfo: [], statusMessages: [{ statusCode: "500" }] } });
  check("a genuine failure code is distinguishable", bad.statusCode === "500", bad);
}

// 3. bnBranchFlag is lowercase in life and a real boolean, not the string MOEc's
//    sample showed. Read wrongly, every licence becomes a branch.
{
  const l = parseMoeResponse(BY_OWNER).licences[0]!;
  check("bnBranchFlag false is not truthy", l.isBranch === false);
  const branch = JSON.parse(JSON.stringify(BY_OWNER));
  branch.getLicenseDetailsByOwnerID_Response.licenseInfo[0].licenseDetails.bnBranchFlag = true;
  check("bnBranchFlag true reads true", parseMoeResponse(branch).licences[0]!.isBranch === true);
}

// 4. by-ern: licenseInfo is an OBJECT, and this is the call that has owners.
{
  const r = parseMoeResponse(BY_ERN);
  check("the single object parses", r.licences.length === 1, r.licences.length);
  check("statusCode 100", r.statusCode === "100", r.statusCode);
  const l = r.licences[0]!;
  check("owner is read", l.owners.length === 1, l.owners);
  check("owner Emirates ID", l.owners[0]?.emiratesId === "784198687965412", l.owners[0]);
  check("owner passport", l.owners[0]?.passportNo === "GFY266300", l.owners[0]);
}

// 5. PLACEHOLDERS. personFullNameEN is a literal "-" and personEmail is "not
//    applicable". Passed through, the customer is shown a person named "-".
{
  const o = parseMoeResponse(BY_ERN).licences[0]!.owners[0]!;
  check('"-" is not a name', o.nameEn === undefined, o.nameEn);
  check("...so the Arabic name is what survives", (o.nameAr ?? "").startsWith("هادف"), o.nameAr);
  check('"not applicable" is not an email', o.email === undefined, o.email);
  const l = parseMoeResponse(BY_OWNER).licences[0]!;
  check("a null legal representative is undefined", l.legalRepresentative === undefined, l.legalRepresentative);
}

// 6. OWNERSHIP. This is what by-ern exists for, and the middle value is the
//    reason it is three-valued: by-owner never returns owners at all, so a
//    licence from that list must read UNKNOWN, never "not the owner".
{
  const withOwners = parseMoeResponse(BY_ERN).licences[0]!;
  check("the real owner matches", ownerMatch(withOwners, "784198687965412") === "match");
  check("dashed form of the same ID matches", ownerMatch(withOwners, "784-1986-8796541-2") === "match");
  check("someone else does not", ownerMatch(withOwners, "784111111111111") === "no-match");
  const fromList = parseMoeResponse(BY_OWNER).licences[0]!;
  check("a licence with no owners is UNKNOWN, not no-match", ownerMatch(fromList, "784198687965412") === "unknown");
  check("a malformed ID is UNKNOWN", ownerMatch(withOwners, "nonsense") === "unknown");
  check("licenceHolderMatch agrees on the owner", licenceHolderMatch(withOwners, "784198687965412") === "match");
}

// 7. Shapes that must not throw.
{
  check("an unknown root yields nothing", parseMoeResponse({ nope: 1 }).licences.length === 0);
  check("null survives", parseMoeResponse(null).licences.length === 0);
  check("an entry with no ERN is dropped", mapLicence({ licenseDetails: {} }) === null);
  check("EID normalisation still holds", normaliseEmiratesId("784-1986-8796541-2") === "784198687965412");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
