/**
 * EPGL Salesforce live test — full lifecycle against epro--preprod2 using the
 * UPDATED contract (isAgentSource, corrected Service/RecordType ids,
 * EPG_Finance_Summary__c renewal model). Creates DIALOG-TEST records.
 *
 * Run: npx tsx scripts/test-epgl-salesforce.ts  (from apps/web)
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { buildApiTools } from "../lib/integrations";

const STAMP = Date.now().toString().slice(-7);
const TL_NO = `88B${STAMP}`;

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("agent missing");
  const { exec } = await buildApiTools(agent.id, "staging", { authenticated: true });

  const summary: string[] = [];
  const run = async (label: string, tool: string, input: Record<string, unknown>) => {
    const r = await exec(tool, input);
    const body = r.result.slice(r.result.indexOf("\n") + 1);
    console.log(`\n### ${label}\n${r.result.slice(0, 700)}`);
    const ok = /"success"\s*:\s*true/.test(body) || (!r.isError && !/"success"\s*:\s*false/.test(body));
    summary.push(`${ok ? "✅" : "❌"} ${label}`);
    return body;
  };

  // 1) FULL ISSUANCE — per the updated example (isAgentSource, new ids).
  const issuance = await run("1: Full issuance submit", "epglsalesforce__submitLicenseRequest", {
    body: {
      allOrNone: true,
      isAgentSource: true,
      compositeRequest: [
        { method: "POST", referenceId: "NewAccount", url: "/services/data/v66.0/sobjects/Account", body: {
          Name: `DIALOG-TEST-${STAMP} Courier Services`,
          EPG_Company_Name_Arabic__c: "اختبار ديالوج لخدمات البريد",
          EPG_Company_Status__c: "Active",
          EPG_Trade_license_no__c: TL_NO,
          EPG_Trade_Name_in_English__c: `DIALOG-TEST-${STAMP} Courier Services`,
          EPG_Trade_Name_in_Arabic__c: "اختبار ديالوج",
          EPG_Regulator__c: "Dubai - Department of Economy and Tourism",
          BillingStreet: "610 Test", BillingCity: "Dubai", BillingState: "Dubai", BillingCountry: "United Arab Emirates",
          EPG_Emirates__c: "Dubai", EPG_Region__c: "Mirdif", EPG_PO_Box__c: "6666",
          RecordTypeId: "0125f000001xIheAAE", License_Expiry_Date__c: "2027-05-20",
        }},
        { method: "POST", referenceId: "NewPartner", url: "/services/data/v66.0/sobjects/EPG_Partner__c", body: [{
          Name: "DIALOG TEST OWNER", EPG_Company__c: "@{NewAccount.id}", EPG_Share_holder_type__c: "Est. Owner",
          EPG_Contact_No__c: "+971-500000001", EPG_Emirates_ID__c: "784199900000088", EPG_Status__c: "Active",
          EPG_Nationality__c: "United Arab Emirates", EPG_Passport_No__c: "9990088", EPG_Passport_Expiry_Date__c: "2050-10-08",
        }]},
        { method: "POST", referenceId: "NewContact", url: "/services/data/v66.0/sobjects/Contact", body: [{
          FirstName: "Dialog", LastName: "TestContact", Email: `dialog-test-${STAMP}@example.com`, Phone: "551499876",
          Title: "Manager", EPG_Designation__c: "Manager", AccountId: "@{NewAccount.id}",
          EPG_Country_Code__c: "UAE(+971)", Secondary_Contact: "True",
        }]},
        { method: "POST", referenceId: "NewUser", url: "/services/data/v66.0/sobjects/User", body: {
          AccountId: "@{NewAccount.id}", FirstName: "DIALOG", LastName: "TESTOWNER",
          Email: `dialog-test-${STAMP}@mailinator.com`, Phone: "+971-500000001", EPG_Emirates_Id__c: "784199900000088",
        }},
        { method: "POST", referenceId: "NewMember", url: "/services/data/v66.0/sobjects/Members__c", body: [{ AccountId__c: "@{NewAccount.id}", Name: "Test" }]},
        { method: "POST", referenceId: "NewLicenseRequest", url: "/services/data/v66.0/sobjects/EPG_License_Request__c", body: {
          RecordTypeId: "0125f000001xIhuAAE", EPG_Service__c: "a1H5f0000033Q7pEAE", EPG_Account__c: "@{NewAccount.id}",
          serviceId__c: "S-EPG-000002", serviceNameEN__c: "Issue Postal Activity License",
          serviceNameAR__c: "احصل على رخصة نشاط المستودعات والطرود", submissionCount__c: 1, Activity_Codes__c: "5320002",
        }},
      ],
    },
  });
  const accountId = issuance.match(/"NewAccount"[\s\S]{0,220}?"id"\s*:\s*"(001[a-zA-Z0-9]{12,15})"/)?.[1] ?? null;
  const lrId = issuance.match(/"NewLicenseRequest"[\s\S]{0,220}?"id"\s*:\s*"(a1[a-zA-Z0-9]{13,16})"/)?.[1] ?? null;
  console.log(">>> accountId:", accountId, "| licenseRequestId:", lrId);

  if (lrId) {
    // 2) Status of the real request.
    await run("2: getRequestStatus (real id)", "epglsalesforce__getRequestStatus", { id: lrId });

    // 3) Document upload happy path (tiny PDF) linked to the real request.
    await run("3: uploadDocument (real id)", "epglsalesforce__uploadDocument", {
      body: {
        licenseRequestId: lrId,
        fileName: "dialog-test-commitment.pdf",
        fileType: "pdf",
        versionData: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64"),
      },
    });

    // 4) duplicateCheck should find the new account.
    await run("4: duplicateCheck (new trade license)", "epglsalesforce__duplicateCheck", {
      body: { tradeLicenseNumber: TL_NO, emiratesId: "784199900000088", email: `dialog-test-${STAMP}@example.com`, mobileNumber: "+971-500000001" },
    });

    // 5) FULL RENEWAL against the account just created (finance summaries + gotcha booleans + accountant).
    await run("5: Full renewal submit", "epglsalesforce__submitLicenseRequest", {
      body: {
        allOrNone: true,
        isAgentSource: true,
        compositeRequest: [
          { method: "POST", referenceId: "NewAccount", url: "/services/data/v66.0/sobjects/Account", body: {
            Id: accountId ?? undefined,
            EPG_Trade_license_no__c: TL_NO,
            Name: `DIALOG-TEST-${STAMP} Courier Services`,
            EPG_Trade_license_Expiry_date__c: "2028-05-20",
            EPG_Trade_Name_in_English__c: `DIALOG-TEST-${STAMP} Courier Services`,
            EPG_Trade_Name_in_Arabic__c: "اختبار ديالوج",
            RecordTypeId: "0125f000001xIheAAE",
          }},
          { method: "POST", referenceId: "NewContact", url: "/services/data/v66.0/sobjects/Contact", body: [{
            AccountId: "@{NewAccount.id}", FirstName: "Jane", LastName: "Accountant",
            Email: `dialog-acct-${STAMP}@example.com`, Phone: "971501234567",
            EPG_Designation__c: "Accountant", EPG_Country_Code__c: "UAE(+971)", Secondary_Contact: "True",
          }]},
          { method: "POST", referenceId: "NewLicenseRequest", url: "/services/data/v66.0/sobjects/EPG_License_Request__c", body: {
            RecordTypeId: "0125f000001xIhwAAE", EPG_Account__c: "@{NewAccount.id}", EPG_Service__c: "a1H5f0000033Q7lEAE",
            serviceId__c: "S-EPG-000003", serviceNameEN__c: "Renew Postal Activity License",
            EPG_Terms_and_Conditions__c: true, Approved_Commitment_Form__c: true,
            Mandatory_integration_with_IDEP__c: true, EPG_Is_Financial_Statement_Submitted__c: true,
          }},
          { method: "POST", referenceId: "NewTrialBalance", url: "/services/data/v66.0/sobjects/EPG_Finance_Summary__c", body: [
            { EPG_License_Request__c: "@{NewLicenseRequest.id}", Quarter__c: "Q1", EPG_Year__c: "2025", Name: "Q1 2025", EPG_Leviable_Income__c: 100000, EPG_Non_Leviable_Income__c: 0 },
            { EPG_License_Request__c: "@{NewLicenseRequest.id}", Quarter__c: "Q2", EPG_Year__c: "2025", Name: "Q2 2025", EPG_Leviable_Income__c: 120000, EPG_Non_Leviable_Income__c: 0 },
            { EPG_License_Request__c: "@{NewLicenseRequest.id}", Quarter__c: "Q3", EPG_Year__c: "2025", Name: "Q3 2025", EPG_Leviable_Income__c: 110000, EPG_Non_Leviable_Income__c: 0 },
            { EPG_License_Request__c: "@{NewLicenseRequest.id}", Quarter__c: "Q4", EPG_Year__c: "2025", Name: "Q4 2025", EPG_Leviable_Income__c: 130000, EPG_Non_Leviable_Income__c: 0 },
          ]},
        ],
      },
    });
  }

  console.log("\n===== SUMMARY =====");
  for (const s of summary) console.log(s);
  console.log(`account: ${accountId} | licenseRequest: ${lrId} | tradeLicense: ${TL_NO}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
