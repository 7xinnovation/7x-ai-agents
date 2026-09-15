/**
 * API 5 changed under us, and the error message hid it.
 *
 * Emirates Post's card-payment test on 15 September: "Files (0)" on the licence
 * request. Documents attached normally at 16:09 on the 14th and all eight failed
 * at 07:34 on the 15th, with nothing on our side having touched the upload path.
 * EPGL had redeployed POST /EPGL/Document — which they said on the 14th they
 * WOULD do, before sending the swagger.
 *
 * Probed against their PreProd org. Every line below is a response they gave:
 *
 *   versionData + fileName + licenseRequestId
 *     -> 400 "content (base64 file data) is required."
 *   content + fileName + licenseRequestId
 *     -> 400 "Either licenseRequestId or accountId is required."   (it was sent)
 *   content + EPG_File_Name__c + EPG_License_Request__c
 *     -> 201 success, createdNewDocument: true
 *   the same again with EPG_File_Id__c
 *     -> 200 success, createdNewDocument: FALSE — it upserts
 *
 * Their written contract (2.0.0) arrived that evening and corrected the rest of
 * the body. Two lines of it undo what the probe had settled for:
 *
 *   "EPG_Document__c.Name is the document slot and is taken from label__c...
 *    if it is omitted, each call with a different file name creates a separate
 *    document record."
 *   "EPG_File_Id__c — leave it out unless the file also exists in an external
 *    system. When omitted Salesforce stores the Salesforce ContentDocumentId
 *    there, which is what marks the document as uploaded."
 *
 * So EPG_File_Id__c is THEIRS to fill, not ours, and the dedup key is the slot
 * name. Documents also left the composite entirely in the same contract.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-document-api5-2026-09-15.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const at = route.indexOf("const res = await execIntegration(tool, {");
const push = route.slice(at, route.indexOf("});", at));

console.log("\nThe payload EPGL now accept");
check("the file goes as `content`", /content: Buffer\.from\(stored\.bytes\)\.toString\("base64"\)/.test(push));
check("the name goes as EPG_File_Name__c", /EPG_File_Name__c: fileName/.test(push));
check("the link goes as EPG_License_Request__c", /EPG_License_Request__c: ref/.test(push));

console.log("\nAnd the names they no longer accept are gone");
for (const dead of ["versionData:", "licenseRequestId:", "fileName:", "fileType:"])
  check(`no \`${dead}\``, !new RegExp(dead.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(push), dead);

console.log("\nThe metadata their 2.0.0 contract asks for");
check("the slot name goes as label__c", /label__c: label/.test(push));
check("...built from the checklist mapping, not the file name", /epglDocumentLabel\(d\.key/.test(route));
// The payload quotes their own wording about it in a comment, so the test is
// for an assignment, not a mention.
check("EPG_File_Id__c is left for Salesforce to fill", !/EPG_File_Id__c\s*:/.test(push));
check("docType__c is the KIND of document", /docType__c: label/.test(push));
check("fileType__c is the format, spelled with a capital T", /fileType__c: ext/.test(push) && !/filetype__c/.test(push));
check("the size, from the bytes rather than guessed", /fileSize__c: stored\.bytes\.length/.test(push));
check("and who sent it", /uploadBy__c: "Agent AI"/.test(push));

console.log("\nDocuments no longer travel in the composite");
check("the composite strips any document item", /withoutEpglDocuments\(input\)/.test(readFileSync(new URL("../lib/integrations.ts", import.meta.url), "utf8")));

console.log("\nWhat did not change");
check("the push still happens after a successful submission", /if \(submittedReference && uploadDocTool && storageGet/.test(route));
check("...and on any later turn, for whatever has not gone", /submittedRef \?\? \(finalState\.status === "submitted"/.test(route));
check("...only against a Salesforce record id", /\^\[a-zA-Z0-9\]\{15,18\}\$\/\.test\(submittedReference\)/.test(route));
check("...deferred, so the chat is not held open", /deferred\.push\(async \(\) => \{/.test(route));
check("...and each file is audited either way", /action: res\.isError \? "sf_document_failed" : "sf_document_attached"/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
