/**
 * Document placeholders in the EPGL composite (2026-09-02).
 *
 * Salesforce tracks an application's files as EPG_Document__c rows -- one per
 * file -- and the Documents panel on the licence request lists those, not the
 * files themselves. LR-37176 and LR-37177 both uploaded their files successfully
 * (HTTP 201, linked to the request) and both showed an empty panel, because the
 * composite carried no placeholders. The model was asked for them and sent none
 * twice, so they are built server-side.
 *
 * Run from apps/web:
 *   npx tsx scripts/test-epgl-doc-placeholders-2026-09-02.ts
 */
import { withEpglDocumentPlaceholders, type EpglDocumentRow } from "@/lib/integrations";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

const DOCS: EpglDocumentRow[] = [
  { key: "trade_license", fileName: "Postal  GSI.pdf", fileType: "pdf", sizeBytes: 478563, fileId: "11111111-1111-1111-1111-111111111111" },
  { key: "moa", fileName: "MOA GSI.pdf", fileType: "pdf", sizeBytes: 299756, fileId: "22222222-2222-2222-2222-222222222222" },
];

const composite = (extra: Record<string, unknown>[] = []) => ({
  body: {
    allOrNone: true,
    isAgentSource: true,
    compositeRequest: [
      { method: "POST", referenceId: "NewAccount", url: "/services/data/v66.0/sobjects/Account", body: { Name: "GULF SYSTEM INTERNATIONAL SHIPPING GFS L.L.C" } },
      { method: "POST", referenceId: "NewContact", url: "/services/data/v66.0/sobjects/Contact", body: { AccountId: "@{NewAccount.id}" } },
      ...extra,
      { method: "POST", referenceId: "NewLicenseRequest", url: "/services/data/v66.0/sobjects/EPG_License_Request__c", body: { EPG_Account__c: "@{NewAccount.id}" } },
    ],
  },
});
const itemsOf = (out: unknown) =>
  (((out as Record<string, any>)?.body?.compositeRequest ?? []) as Record<string, any>[]);

// 1. One placeholder per file, in their spec's shape.
{
  const items = itemsOf(withEpglDocumentPlaceholders(composite(), DOCS));
  const doc = items.find((i) => /EPG_Document__c/.test(String(i.url)));
  check("a document item is added", !!doc, items.map((i) => i.referenceId));
  check("it carries method, referenceId and url",
    doc?.method === "POST" && !!doc?.referenceId && doc?.url === "/services/data/v66.0/sobjects/EPG_Document__c", doc);
  check("one row per uploaded file", Array.isArray(doc?.body) && doc.body.length === 2, doc?.body?.length);
  const r = doc?.body?.[0];
  check("the row points at the Account", r?.EPG_Company__c === "@{NewAccount.id}", r);
  check("with the file's name, type and size",
    r?.EPG_File_Name__c === "Postal  GSI.pdf" && r?.docType__c === "pdf" && r?.fileType__c === "pdf" && r?.fileSize__c === 478563, r);
  check("and its file id", r?.EPG_File_Id__c === DOCS[0]!.fileId);
  const at = (re: RegExp) => items.findIndex((i) => re.test(String(i.url)));
  check("it sits after the Account and before the licence request",
    at(/sobjects\/Account$/) < at(/EPG_Document__c/) && at(/EPG_Document__c/) < at(/EPG_License_Request__c/),
    items.map((i) => i.referenceId));
}

// 2. A referenceId we did not choose is still what the rows point at.
{
  const custom = {
    body: { compositeRequest: [
      { method: "POST", referenceId: "TheCompany", url: "/services/data/v66.0/sobjects/Account", body: {} },
      { method: "POST", referenceId: "NewLicenseRequest", url: "/services/data/v66.0/sobjects/EPG_License_Request__c", body: {} },
    ] },
  };
  const doc = itemsOf(withEpglDocumentPlaceholders(custom, DOCS)).find((i) => /EPG_Document__c/.test(String(i.url)));
  check("the rows follow the Account's own referenceId", doc?.body?.[0]?.EPG_Company__c === "@{TheCompany.id}", doc?.body?.[0]);
}

// 3. Things we must not touch.
{
  const own = [{ method: "POST", referenceId: "MyDoc", url: "/services/data/v66.0/sobjects/EPG_Document__c", body: [{ EPG_File_Name__c: "theirs.pdf" }] }];
  const docs = itemsOf(withEpglDocumentPlaceholders(composite(own), DOCS)).filter((i) => /EPG_Document__c/.test(String(i.url)));
  check("a composite that already has documents is left alone",
    docs.length === 1 && docs[0]!.referenceId === "MyDoc", docs.map((d) => d.referenceId));

  check("no uploads means no placeholder",
    !itemsOf(withEpglDocumentPlaceholders(composite(), [])).some((i) => /EPG_Document__c/.test(String(i.url))));

  const noAccount = { body: { compositeRequest: [{ method: "POST", referenceId: "X", url: "/services/data/v66.0/sobjects/Contact", body: {} }] } };
  check("without an Account there is nothing to hang them on",
    !itemsOf(withEpglDocumentPlaceholders(noAccount, DOCS)).some((i) => /EPG_Document__c/.test(String(i.url))));

  check("a body that is not a composite is returned unchanged",
    withEpglDocumentPlaceholders({ body: { foo: 1 } }, DOCS)?.body !== undefined &&
      JSON.stringify(withEpglDocumentPlaceholders({ body: { foo: 1 } }, DOCS)) === JSON.stringify({ body: { foo: 1 } }));

  check("no input at all is survivable", withEpglDocumentPlaceholders(undefined, DOCS) === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
