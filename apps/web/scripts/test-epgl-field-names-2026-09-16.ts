/**
 * The applicant's account link, and a licence member who arrives with a role.
 *
 * YI FANG TAIWAN FRUIT TEA L.L.C, 16 September, a new licence. Three
 * submissions, each answered "Value does not exist or does not match filter
 * criteria." with all seven records rolled back, and an applicant told the
 * problem was on our side and to phone EPGL. It was on our side: the User item
 * linked the applicant to the company with `EPG_Company__c`, which is the
 * partner's field. EPGL's handler reads `EPG_Account__c`. Verified against
 * their sandbox — the same payload with that one key renamed submits and
 * returns ids.
 *
 * Members__c fails the other way, silently: `EPG_Role__c`, `EPG_Nationality__c`
 * and `EPG_Name_Arabic__c` do not exist on the object, a SOQL for any of them
 * is a 400, and the handler writes the row anyway with those values dropped.
 * Every licence member recorded so far has a name and nothing else.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-field-names-2026-09-16.ts
 */
import { withEpglRequestFields } from "../lib/integrations";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got, null, 1)}`}`); }
};

const item = (object: string, body: Record<string, unknown>, referenceId: string) => ({
  method: "POST", referenceId, url: `/services/data/v66.0/sobjects/${object}`, body,
});
const run = (items: unknown[]) =>
  withEpglRequestFields({ body: { allOrNone: true, isAgentSource: true, compositeRequest: items } }, {})!;
const bodies = (out: Record<string, unknown>) =>
  Object.fromEntries(
    ((out.body as Record<string, unknown>).compositeRequest as { referenceId: string; body: Record<string, unknown> }[])
      .map((i) => [i.referenceId, i.body])
  );

console.log("\nThe applicant's link to the company");
{
  const out = bodies(run([
    item("Account", { Name: "YI FANG TAIWAN FRUIT TEA L.L.C" }, "NewAccount"),
    item("User", { Email: "a@b.ae", LastName: "Karayalcin", EPG_Company__c: "@{NewAccount.id}" }, "NewUser"),
  ]));
  check("EPG_Company__c becomes EPG_Account__c", out.NewUser!.EPG_Account__c === "@{NewAccount.id}", out.NewUser);
  check("...and the wrong key is gone", !("EPG_Company__c" in out.NewUser!), out.NewUser);
  check("nothing else on the item is touched", out.NewUser!.LastName === "Karayalcin" && out.NewUser!.Email === "a@b.ae");
}

console.log("\nA partner keeps EPG_Company__c — it is that object's real field");
{
  const out = bodies(run([
    item("Account", { Name: "YI FANG" }, "NewAccount"),
    item("EPG_Partner__c", { Name: "Faisal Eissa Lutfi Ali Hussain", EPG_Company__c: "@{NewAccount.id}" }, "NewPartner1"),
  ]));
  check("partner is left alone", out.NewPartner1!.EPG_Company__c === "@{NewAccount.id}", out.NewPartner1);
}

console.log("\nA licence member arrives whole");
{
  const out = bodies(run([
    item("Members__c", {
      Name: "FAISAL EISSA LUTFI ALI HUSSAIN",
      EPG_Role__c: "Manager",
      EPG_Nationality__c: "United Arab Emirates",
      EPG_Member_Name_Arabic__c: "فيصل عيسى لطفى على حسين",
      AccountId__c: "@{NewAccount.id}",
    }, "NewMember1"),
  ])).NewMember1!;
  check("role", out.DUL_License_Members_MemberRoleEn__c === "Manager", out);
  check("nationality", out.DULLicenseMembersNationalityEn__c === "United Arab Emirates", out);
  check("Arabic name", out.DUL_License_Members_Person_NameAr__c === "فيصل عيسى لطفى على حسين", out);
  check("English name mirrors the record name", out.DUL_License_Members_Person_NameEn__c === "FAISAL EISSA LUTFI ALI HUSSAIN", out);
  check("the record name is kept", out.Name === "FAISAL EISSA LUTFI ALI HUSSAIN");
  check("the account link is kept", out.AccountId__c === "@{NewAccount.id}");
  for (const dead of ["EPG_Role__c", "EPG_Nationality__c", "EPG_Member_Name_Arabic__c"]) {
    check(`${dead} is not sent`, !(dead in out), out);
  }
}

console.log("\nThe other spelling of the member's Arabic name");
{
  const out = bodies(run([item("Members__c", { Name: "ZHAO ZHAO", EPG_Name_Arabic__c: "زهاو زهاو" }, "M")])).M!;
  check("EPG_Name_Arabic__c lands too", out.DUL_License_Members_Person_NameAr__c === "زهاو زهاو", out);
}

console.log("\nA payload that was already right is not disturbed");
{
  const already = {
    Name: "ZHAO ZHAO",
    AccountId__c: "001x",
    DUL_License_Members_Person_NameEn__c: "ZHAO ZHAO",
    DUL_License_Members_MemberRoleEn__c: "Manager",
  };
  const out = bodies(run([item("Members__c", { ...already }, "M")])).M!;
  check("unchanged", JSON.stringify(out) === JSON.stringify(already), out);
}

console.log("\nThe correct name wins when both are present");
{
  const out = bodies(run([item("User", { EPG_Account__c: "001right", EPG_Company__c: "001wrong" }, "U")])).U!;
  check("keeps EPG_Account__c", out.EPG_Account__c === "001right", out);
  check("drops the wrong key", !("EPG_Company__c" in out), out);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
