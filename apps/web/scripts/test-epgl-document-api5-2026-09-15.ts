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
 * Run from apps/web:  npx tsx scripts/test-epgl-document-api5-2026-09-15.ts
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got)}`}`); }
};

const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const push = route.slice(route.indexOf("const res = await execIntegration(tool, {"), route.indexOf("const res = await execIntegration(tool, {") + 700);

console.log("\nThe payload EPGL now accept");
check("the file goes as `content`", /content: Buffer\.from\(stored\.bytes\)\.toString\("base64"\)/.test(push));
check("the name goes as EPG_File_Name__c", /EPG_File_Name__c: fileName/.test(push));
check("the link goes as EPG_License_Request__c", /EPG_License_Request__c: ref/.test(push));

console.log("\nAnd the names they no longer accept are gone");
for (const dead of ["versionData:", "licenseRequestId:", "fileName:", "fileType:"])
  check(`no \`${dead}\``, !new RegExp(dead.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(push), dead);

console.log("\nThe metadata they asked for on the 14th");
check("the document's own id, so a retry upserts", /EPG_File_Id__c: row\.id/.test(push));
check("the type, twice, as they spell it", /docType__c: ext/.test(push) && /filetype__c: ext/.test(push));
check("the size, from the bytes rather than guessed", /fileSize__c: stored\.bytes\.length/.test(push));

console.log("\nWhat did not change");
check("the push still happens after a successful submission", /if \(submittedRef && uploadDocTool && storageGet/.test(route));
check("...only against a Salesforce record id", /\^\[a-zA-Z0-9\]\{15,18\}\$\/\.test\(submittedRef\)/.test(route));
check("...deferred, so the chat is not held open", /deferred\.push\(async \(\) => \{/.test(route));
check("...and each file is audited either way", /action: res\.isError \? "sf_document_failed" : "sf_document_attached"/.test(route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
