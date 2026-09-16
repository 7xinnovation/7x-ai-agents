/**
 * Licence-request fields, filled from the case (2026-09-03).
 *
 * The EPGL composite is composed by the MODEL, so which fields it carries varies
 * run to run -- and under repeated prompting it gets shorter. LR-37212's request
 * carried the emirate, region, activity codes, terms acceptance, the amount paid
 * and the payment reference. LR-37214, submitted after the customer had asked
 * three times whether it was submitting, carried five fields and none of those:
 * same journey, same data collected, a record with Payment Info empty and Terms
 * and Conditions unticked.
 *
 * None of these are judgement calls -- every one is a value already on the case
 * or a payment already settled -- so they are written rather than requested.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-epgl-request-fields-2026-09-03.ts
 */
import { withEpglRequestFields, type EpglRequestFacts } from "@/lib/integrations";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? "");
  ok ? pass++ : fail++;
};

const FACTS: EpglRequestFacts = {
  emirate: "Dubai",
  region: "Al Mankhool",
  // The DED activities off the trade licence. They are not postal activity
  // codes, and since 2026-09-08 they are no longer sent as if they were.
  activityCodes: "Letters & Post Items Delivery, Parcels Delivery",
  regulator: "Dep. of Economic Development",
  termsAccepted: true,
  amountPaid: 1010,
  paymentReference: "a1f03189-e195-4676-93c8-9faae9df452f",
};

/** LR-37214's composite: the thin one. */
const thin = () => ({
  body: {
    compositeRequest: [
      { method: "POST", referenceId: "NewAccount", url: "/services/data/v66.0/sobjects/Account", body: { Name: "YI FANG TAIWAN FRUIT TEA L.L.C" } },
      { method: "POST", referenceId: "NewLicenseRequest", url: "/services/data/v66.0/sobjects/EPG_License_Request__c", body: { serviceId: "S-EPG-000002", EPG_Account__c: "@{NewAccount.id}" } },
    ],
  },
});
const itemOf = (out: unknown, ref: string) =>
  (((out as Record<string, any>)?.body?.compositeRequest ?? []) as Record<string, any>[]).find((i) => i.referenceId === ref)?.body ?? {};

// 1. The fields LR-37214 dropped are put back.
{
  const lr = itemOf(withEpglRequestFields(thin(), FACTS), "NewLicenseRequest");
  check("amount paid", lr.EPG_Amount_Paid__c === 1010, lr.EPG_Amount_Paid__c);
  // 2026-09-13: NOT sent any more. EPGL confirmed they store
  // notifyPayment.payment.paymentId from the payment notification themselves,
  // and a describe of EPG_License_Request__c on their org has no such field —
  // we were filling in a reference nobody could receive.
  check("payment reference is no longer sent", lr.EPG_Payment_Reference__c === undefined, lr.EPG_Payment_Reference__c);
  check("terms accepted", lr.EPG_Terms_and_Conditions__c === true, lr.EPG_Terms_and_Conditions__c);
  check("emirate", lr.EPG_Current_Emirate__c === "Dubai", lr.EPG_Current_Emirate__c);
  check("region", lr.EPG_Current_Region__c === "Al Mankhool", lr.EPG_Current_Region__c);
  check("activities, as numeric codes", lr.Activity_Codes__c === "5320002,5320009", lr.Activity_Codes__c);
  check("what the model DID send survives", lr.serviceId === "S-EPG-000002" && lr.EPG_Account__c === "@{NewAccount.id}", lr);
  const acct = itemOf(withEpglRequestFields(thin(), FACTS), "NewAccount");
  check("regulator lands on the account", acct.EPG_Regulator__c === "Dep. of Economic Development", acct);
}

// 2. The model's own values WIN. This fills gaps; it does not overrule what was
//    read off the customer's documents.
{
  const mine = thin() as Record<string, any>;
  mine.body.compositeRequest[1].body.EPG_Current_Emirate__c = "Sharjah";
  mine.body.compositeRequest[1].body.EPG_Amount_Paid__c = 2020;
  const lr = itemOf(withEpglRequestFields(mine, FACTS), "NewLicenseRequest");
  check("the model's emirate is not overwritten", lr.EPG_Current_Emirate__c === "Sharjah", lr.EPG_Current_Emirate__c);
  check("the model's amount is not overwritten", lr.EPG_Amount_Paid__c === 2020, lr.EPG_Amount_Paid__c);
  check("...and the gaps are still filled", lr.EPG_Current_Region__c === "Al Mankhool", lr.EPG_Current_Region__c);
}

// 3. Nothing known, nothing written. An unpaid case must not claim an amount,
//    and unticked terms must not be ticked on the customer's behalf.
{
  const lr = itemOf(withEpglRequestFields(thin(), {}), "NewLicenseRequest");
  check("no amount invented", lr.EPG_Amount_Paid__c === undefined, lr.EPG_Amount_Paid__c);
  check("no reference invented", lr.EPG_Payment_Reference__c === undefined, lr.EPG_Payment_Reference__c);
  check("terms not ticked", lr.EPG_Terms_and_Conditions__c === undefined, lr.EPG_Terms_and_Conditions__c);
  const notAccepted = itemOf(withEpglRequestFields(thin(), { termsAccepted: false }), "NewLicenseRequest");
  check("an explicit false does not tick them either", notAccepted.EPG_Terms_and_Conditions__c === undefined, notAccepted);
  check("empty strings are not written", itemOf(withEpglRequestFields(thin(), { region: "" }), "NewLicenseRequest").EPG_Current_Region__c === undefined);
}

// 4. Shapes that must not throw.
{
  check("no composite is returned unchanged", withEpglRequestFields({ body: {} }, FACTS)?.body !== undefined);
  check("undefined input survives", withEpglRequestFields(undefined, FACTS) === undefined || true);
  const noLr = { body: { compositeRequest: [{ referenceId: "NewAccount", url: "/sobjects/Account", body: {} }] } };
  check("a composite with no licence request still patches the account",
    itemOf(withEpglRequestFields(noLr, FACTS), "NewAccount").EPG_Regulator__c === "Dep. of Economic Development");
}


/**
 * ONE PERSON, ONE PARTNER ROW.
 *
 * LR-37377, 15 September. The trade licence and the MOA both name partner 2
 * "Abdelaziz Mohamed Obaid". His Emirates ID names him "Mohamed Abdelaziz
 * Mohamed Balhaif Alnuaimi" — the same man, as UAE names routinely are — and
 * the composite went out with the card's version. EPGL's account now carries
 * both, as two partners, and the next submission would have added a third.
 */
{
  const partnerItem = (referenceId: string, Name: string) => ({
    method: "POST",
    referenceId,
    url: "/services/data/v66.0/sobjects/EPG_Partner__c",
    body: { Name, EPG_Nationality__c: "United Arab Emirates" },
  });
  const composite = (...extra: unknown[]) => ({
    body: {
      allOrNone: true,
      compositeRequest: [
        { method: "POST", referenceId: "NewAccount", url: "/services/data/v66.0/sobjects/Account", body: { Name: "YI FANG" } },
        ...extra,
      ],
    },
  });
  const onLicence = ["Faisal Eissa Lutfi Ali Hussain", "Abdelaziz Mohamed Obaid", "Valentina Mintah"];
  const nameOf = (out: unknown, ref: string) =>
    ((out as any)?.body?.compositeRequest ?? []).find((i: any) => i.referenceId === ref)?.body?.Name;

  const out = withEpglRequestFields(
    composite(
      partnerItem("NewPartner1", "Faisal Eissa Lutfi Ali Hussain"),
      partnerItem("NewPartner2", "Mohamed Abdelaziz Mohamed Balhaif Alnuaimi"),
      partnerItem("NewPartner3", "Valentina Mintah")
    ) as never,
    { partnerNames: onLicence } as never
  );
  check("the Emirates ID spelling is replaced by the licence's", nameOf(out, "NewPartner2") === "Abdelaziz Mohamed Obaid", nameOf(out, "NewPartner2"));
  check("...and the ones that already agreed are untouched", nameOf(out, "NewPartner1") === onLicence[0] && nameOf(out, "NewPartner3") === onLicence[2]);

  // A genuinely different person is a MISFILED partner, not a spelling — left
  // alone, because silently renaming it would hide the mistake.
  const stranger = withEpglRequestFields(
    composite(partnerItem("NewPartner2", "Nida Zafar Awan")) as never,
    { partnerNames: onLicence } as never
  );
  check("a different person is left alone", nameOf(stranger, "NewPartner2") === "Nida Zafar Awan", nameOf(stranger, "NewPartner2"));

  // No licence name for that slot: nothing to correct against.
  const noName = withEpglRequestFields(
    composite(partnerItem("NewPartner7", "Someone Else")) as never,
    { partnerNames: onLicence } as never
  );
  check("a partner the licence never named is left alone", nameOf(noName, "NewPartner7") === "Someone Else");
}



/**
 * AN ACCOUNT ID IS NOT THE MODEL'S TO INVENT.
 *
 * JNT's renewal, 16 September. The composite's Account item carried
 * "Id": "0015f00000XwXwXAAV" — an id that does not exist. JNT's account is
 * 0015f00000ic9okAAA and EPGL's own lookup had returned it minutes earlier.
 * Salesforce answered "invalid cross reference id | portal account owner must
 * have a role", allOrNone rolled back all six records, and the applicant was
 * told EPGL had a configuration problem they do not have.
 */
{
  const REAL = "0015f00000ic9okAAA";
  const INVENTED = "0015f00000XwXwXAAV";
  const composite = () => ({
    body: {
      allOrNone: true,
      compositeRequest: [
        { method: "POST", referenceId: "Account", url: "/services/data/v66.0/sobjects/Account", body: { Id: INVENTED, Name: "JNT EXPRESS COURIER SERVICES L.L.C" } },
        { method: "POST", referenceId: "NewPartner1", url: "/services/data/v66.0/sobjects/EPG_Partner__c", body: { Name: "GLOBAL JET EXPRESS AE FZCO", EPG_Company__c: INVENTED } },
        { method: "POST", referenceId: "NewMember1", url: "/services/data/v66.0/sobjects/Members__c", body: { Name: "ZHAO ZHAO", AccountId__c: INVENTED } },
        { method: "POST", referenceId: "NewLicenseRequest", url: "/services/data/v66.0/sobjects/EPG_License_Request__c", body: { EPG_Account__c: "@{Account.id}" } },
      ],
    },
  });
  const itemBody = (out: unknown, ref: string) =>
    ((out as any)?.body?.compositeRequest ?? []).find((i: any) => i.referenceId === ref)?.body ?? {};

  const out = withEpglRequestFields(composite() as never, { accountId: REAL } as never);
  check("the invented account id is replaced", itemBody(out, "Account").Id === REAL, itemBody(out, "Account").Id);
  check("...wherever it was copied to", itemBody(out, "NewPartner1").EPG_Company__c === REAL, itemBody(out, "NewPartner1"));
  check("...including the member row", itemBody(out, "NewMember1").AccountId__c === REAL, itemBody(out, "NewMember1"));
  check("a @{reference} is left alone", itemBody(out, "NewLicenseRequest").EPG_Account__c === "@{Account.id}");
  check("nothing else on the account is touched", itemBody(out, "Account").Name === "JNT EXPRESS COURIER SERVICES L.L.C");

  // The id we hold is the one the LOOKUP returned. With none, nothing is stamped
  // — a new company has no account yet and inventing one here is the same fault.
  const none = withEpglRequestFields(composite() as never, {} as never);
  check("no known account, no rewrite", itemBody(none, "Account").Id === INVENTED);
  const rubbish = withEpglRequestFields(composite() as never, { accountId: "not-an-id" } as never);
  check("and a malformed id is not stamped either", itemBody(rubbish, "Account").Id === INVENTED);

  // An id that was already right stays right, and its children are untouched.
  const already = {
    body: { allOrNone: true, compositeRequest: [
      { method: "POST", referenceId: "UpdateAccount", url: "/services/data/v66.0/sobjects/Account", body: { Id: REAL } },
      { method: "POST", referenceId: "Partner1", url: "/services/data/v66.0/sobjects/EPG_Partner__c", body: { EPG_Company__c: REAL } },
    ] },
  };
  const same = withEpglRequestFields(already as never, { accountId: REAL } as never);
  check("a correct composite is left as it is", itemBody(same, "UpdateAccount").Id === REAL && itemBody(same, "Partner1").EPG_Company__c === REAL);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);