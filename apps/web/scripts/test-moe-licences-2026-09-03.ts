/**
 * MOEc trade-licence lookup by Emirates ID (2026-09-03).
 *
 * Every field in this response is a MOEc spelling that differs from the one
 * beside it -- BNRegNameEn, licenseLocalID, isManagerResidentofUAE, booleans as
 * strings, a repeated block that arrives unwrapped when there is only one. None
 * of that fails loudly if it drifts; it just quietly returns undefined and the
 * customer gets asked to type a licence number we already had.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-moe-licences-2026-09-03.ts
 */
import {
  mapLicence,
  parseOwnerDetails,
  normaliseEmiratesId,
  licenceHolderMatch,
  licencesByEmiratesId,
  moeIsMock,
  moeConfigured,
  __resetMoeCaches,
  type MoeLicence,
} from "@/lib/moeLicences";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

/** MOEc's own published sample, trimmed to the fields we read. */
const SAMPLE_ENTRY = () => ({
  licenseDetails: {
    licenseERN: "4120000000047016407",
    licenseLocalID: "47016407",
    licenseIssuanceEDID: 30,
    BNRegNameAr: "الاسم بالعربية",
    BNRegNameEn: "Company Name FZ-LLC",
    licenseRegistrationDate: "2024-10-28T00:00:00",
    licenseExpirationDate: "2025-10-27T00:00:00",
    licenseStatusID: "MOECID7",
    licenseTypeID: "ZSRL",
    licenseLegalTypeID: "17",
    licenseFullAddress: "Compass Building, Al Hamra Industrial Zone-FZ, Ras Al Khaimah, UAE",
    licenseAddrEmirate: "4",
    licenseMobPhoneNo: "+971523854570",
    licenseOfficialEmail: "owner@example.com",
    licenseCapitalAED: 100000.0,
    isLicenseListedinUAEExchanges: "false",
    licenseLegalRepresentativeName: "Legal Rep",
    BNBranchFlag: "false",
  },
  licenseActivities: {
    licenseActivity: [
      { activityCode: "271749963", activityNameEN: "Marketing Management", activityNameAR: "الادارة التسويقية", activityStartDate: "2024-10-28T00:00:00" },
    ],
  },
  Managers: {
    ManagerDetails: [
      {
        managerFullNameEN: "Manager Name", managerFullNameAR: "اسم المدير",
        managerMobileNo: "+971552223456", managerNationality: "NG",
        managerEmail: "mgr@example.com", managerEmiratesID: "784198970768309",
        isManagerResidentofUAE: "false",
      },
    ],
  },
  Owners: {
    PersonDetails: [
      { personFullNameEN: "Owner Name", personEmiratesID: "784-1999-8392642-1", personNationality: "AE", personSharePercentage: "100" },
    ],
  },
});

const wrap = (entries: unknown[], statusCode = "100") => ({
  getLicenseDetailsByOwnerID_Response: {
    licenseInfo: entries,
    statusMessages: [{ statusCode, statusDescriptionEN: statusCode === "100" ? "Success" : "Failure" }],
  },
});

// 1. The published sample maps field for field.
{
  const l = mapLicence(SAMPLE_ENTRY() as Record<string, unknown>)!;
  check("ERN is read", l.ern === "4120000000047016407", l.ern);
  check("licenseLocalID is the trade licence number", l.tradeLicenseNo === "47016407", l.tradeLicenseNo);
  check("English name", l.nameEn === "Company Name FZ-LLC", l.nameEn);
  check("Arabic name", l.nameAr === "الاسم بالعربية", l.nameAr);
  check("issuing entity is stringified", l.issuingEntityCode === "30", l.issuingEntityCode);
  check("expiry", l.expiryDate === "2025-10-27T00:00:00", l.expiryDate);
  check("activity", l.activities[0]?.nameEn === "Marketing Management", l.activities);
  check("manager EID normalised", l.managers[0]?.emiratesId === "784198970768309", l.managers[0]);
  check("owner EID normalised from dashes", l.owners[0]?.emiratesId === "784199983926421", l.owners[0]);
  check("owner share is numeric", l.owners[0]?.sharePercent === 100, l.owners[0]);
}

// 2. MOEc codes are carried RAW. Translating "4" to an emirate would be wrong --
//    this licence sits at emirate 4 and its address says Ras Al Khaimah, which is
//    not what the usual UAE ordering would give.
{
  const l = mapLicence(SAMPLE_ENTRY() as Record<string, unknown>)!;
  check("emirate code kept raw", l.emirateCodeRaw === "4", l.emirateCodeRaw);
  check("status code kept raw", l.statusCodeRaw === "MOECID7", l.statusCodeRaw);
  check("no translated emirate field exists", !("emirate" in (l as object)), Object.keys(l));
}

// 3. "false" is a string upstream; a naive read makes every licence a branch.
{
  const branch = SAMPLE_ENTRY() as Record<string, any>;
  check("BNBranchFlag 'false' is not truthy", mapLicence(branch)!.isBranch === false);
  branch.licenseDetails.BNBranchFlag = "true";
  check("BNBranchFlag 'true' reads true", mapLicence(branch)!.isBranch === true);
  const mgr = SAMPLE_ENTRY() as Record<string, any>;
  check("manager residency 'false' is false", mapLicence(mgr)!.managers[0]?.isUaeResident === false);
}

// 4. A single repeated entry can arrive unwrapped rather than as a one-item array.
{
  const one = SAMPLE_ENTRY() as Record<string, any>;
  one.Managers.ManagerDetails = one.Managers.ManagerDetails[0];
  one.licenseActivities.licenseActivity = one.licenseActivities.licenseActivity[0];
  const l = mapLicence(one)!;
  check("unwrapped manager still read", l.managers.length === 1, l.managers);
  check("unwrapped activity still read", l.activities.length === 1, l.activities);
}

// 5. Empty blocks are empty lists, never crashes.
{
  const bare = { licenseDetails: { licenseERN: "412", licenseLocalID: "1" } };
  const l = mapLicence(bare as Record<string, unknown>)!;
  check("no blocks at all still maps", l.ern === "412" && l.owners.length === 0 && l.managers.length === 0, l);
  const nulled = SAMPLE_ENTRY() as Record<string, any>;
  nulled.Owners = null; nulled.Managers = ""; nulled.licenseActivities = { licenseActivity: null };
  const l2 = mapLicence(nulled)!;
  check("null/blank blocks are empty lists", l2.owners.length === 0 && l2.managers.length === 0 && l2.activities.length === 0, l2);
  check("an entry with no licenseDetails is dropped", mapLicence({} as Record<string, unknown>) === null);
  check("an entry with no ERN is dropped", mapLicence({ licenseDetails: {} } as Record<string, unknown>) === null);
}

// 6. The literal string "null" is upstream's way of saying absent.
{
  const nulls = SAMPLE_ENTRY() as Record<string, any>;
  nulls.licenseDetails.licenseOfficialEmail = "null";
  nulls.licenseDetails.licenseMobPhoneNo = null;
  const l = mapLicence(nulls)!;
  check("string 'null' is undefined", l.officialEmail === undefined, l.officialEmail);
  check("real null is undefined", l.mobile === undefined, l.mobile);
}

// 7. parseOwnerDetails: several licences, and the status line beside them.
{
  const many = parseOwnerDetails(wrap([SAMPLE_ENTRY(), SAMPLE_ENTRY()]));
  check("both licences parsed", many.licences.length === 2, many.licences.length);
  check("status 100 read", many.statusCode === "100", many.statusCode);
  check("unknown root shape yields nothing", parseOwnerDetails({ nope: 1 }).licences.length === 0);
  check("a null response yields nothing", parseOwnerDetails(null).licences.length === 0);
}

// 8. Owning no company and the lookup failing are DIFFERENT answers, and the
//    difference is only in statusMessages -- both carry an empty licenseInfo.
{
  const empty = parseOwnerDetails(wrap([], "100"));
  check("no licences, status 100", empty.licences.length === 0 && empty.statusCode === "100");
  const refused = parseOwnerDetails(wrap([], "500"));
  check("no licences, status 500 is distinguishable", refused.statusCode === "500", refused);
}

// 8b. Licences that arrive in a shape we do not recognise are NOT "owns nothing".
//     GSB has no staging host, so this path first runs for real in production;
//     it has to be loud rather than silently correct-looking.
{
  const alien = parseOwnerDetails(wrap([{ someOtherShape: { ern: "412" } }, { andAnother: 1 }]));
  check("unrecognised entries are counted raw", alien.rawCount === 2, alien.rawCount);
  check("...and map to nothing", alien.licences.length === 0, alien.licences);
  const genuine = parseOwnerDetails(wrap([]));
  check("a genuinely empty registry answer has rawCount 0", genuine.rawCount === 0);
  const partial = parseOwnerDetails(wrap([SAMPLE_ENTRY(), { junk: true }]));
  check("a mixed response keeps what it can", partial.licences.length === 1 && partial.rawCount === 2, partial);
}

// 9. Emirates ID normalisation.
{
  check("dashed EID", normaliseEmiratesId("784-1999-8392642-1") === "784199983926421");
  check("bare EID", normaliseEmiratesId("784199983926421") === "784199983926421");
  check("14 digits rejected", normaliseEmiratesId("78419998392642") === null);
  check("non-string rejected", normaliseEmiratesId(784199983926421 as unknown) === null);
  check("empty rejected", normaliseEmiratesId("") === null);
}

// 10. Ownership is three-valued: "we could not check" is not "not an owner".
{
  const l = mapLicence(SAMPLE_ENTRY() as Record<string, unknown>)!;
  check("owner matches", licenceHolderMatch(l, "784-1999-8392642-1") === "match");
  check("manager also counts as a holder", licenceHolderMatch(l, "784198970768309") === "match");
  check("a stranger does not match", licenceHolderMatch(l, "784111111111111") === "no-match");
  const blind: MoeLicence = { ...l, owners: [], managers: [] };
  check("no readable holders is UNKNOWN, not no-match", licenceHolderMatch(blind, "784111111111111") === "unknown");
  check("a malformed EID is UNKNOWN, not no-match", licenceHolderMatch(l, "abc") === "unknown");
}

// 11. Staging must not read live government records: with no credentials the
//     module serves a fixture rather than reaching for integrate.gsb.government.ae.
{
  __resetMoeCaches();
  check("unconfigured deployment is not 'configured'", !moeConfigured());
  check("unconfigured deployment defaults to mock", moeIsMock());
  const rows = await licencesByEmiratesId("784-1999-8392642-1");
  check("mock returns a licence", rows.length === 1, rows.length);
  check("mock is obviously synthetic", /TEST DATA/.test(rows[0]?.nameEn ?? ""), rows[0]?.nameEn);
  check("mock owner is a holder", licenceHolderMatch(rows[0]!, "784199000000000") === "match");
  let threw = "";
  await licencesByEmiratesId("nonsense").catch((e) => { threw = String(e.message); });
  check("a malformed EID throws before any call", /accepted format/.test(threw), threw);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
