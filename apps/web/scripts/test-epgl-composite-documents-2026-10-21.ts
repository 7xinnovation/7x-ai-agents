/**
 * The customer's files into the New Regulation composite (2026-10-21).
 *
 * The model composes the composite and cannot hold a file, so the bytes are put
 * in underneath it. Which way they go in depends on size, and that threshold is
 * the thing most worth pinning down: Salesforce refuse a composite carrying
 * more than about 4 MB of base64, and base64 is a third bigger than the file it
 * encodes — so the limit is applied to the RAW bytes, at 3 MB.
 *
 * Verified live against their NewLaw sandbox the same day: a 6.27 MB PDF went
 * up through ContentVersion and attached to its slot on LR-54039, and the
 * multipart shape below is the one that worked. A FormData/Blob metadata part
 * is rejected with "Cannot include more than one binary part", which is why the
 * body is assembled by hand.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-composite-documents-2026-10-21.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INLINE_LIMIT_BYTES,
  isEpglCompositeTool,
  needsTwoStep,
  slugOfDocumentType,
  documentItemsOf,
  withEpglDocumentFiles,
  contentVersionMultipart,
  applicationIdFrom,
  type EpglCaseFile,
} from "@/lib/epglComposite";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));

const file = (key: string, size: number, name = `${key}.pdf`): EpglCaseFile => ({
  key, fileName: name, bytes: new Uint8Array(size).fill(65), contentType: "application/pdf",
});
const composite = (...types: string[]) => ({
  body: {
    allOrNone: true,
    compositeRequest: [
      { method: "POST", url: "/services/data/v60.0/sobjects/Account", referenceId: "NewAccount", body: { Name: "X" } },
      ...types.map((t, i) => ({
        method: "POST", url: "/services/data/v60.0/sobjects/EPG_Document__c",
        referenceId: `Doc${i + 1}`, body: { applicationId__c: "LR-1", Document_Type: t },
      })),
    ],
  },
});

// ------------------------------------------------------------------ the gate
check("the 2.0 composite is recognised", isEpglCompositeTool("epgl_new_regulation__post_services_apexrest_CompositeHandler"));
check("and the 1.x submit is NOT — it strips documents, this fills them", !isEpglCompositeTool("epgl__submitlicenserequest"));

// --------------------------------------------------------------- the threshold
check("the limit is on raw bytes, at 3 MB", INLINE_LIMIT_BYTES === 3_000_000);
check("a small file goes inline", !needsTwoStep(500_000));
check("3 MB exactly still goes inline", !needsTwoStep(3_000_000));
check("just over needs the two-step", needsTwoStep(3_000_001));
// The reason for 3 and not 4: base64 of 3 MB is already 4 MB.
check("base64 of the limit is about 4 MB", Math.round((INLINE_LIMIT_BYTES * 4) / 3 / 1_000_000) === 4);

// ----------------------------------------------------------------- the matching
check("the slug matches the journey's slot keys", slugOfDocumentType("Copy of Passport") === "copy_of_passport");
check("punctuation and case do not matter", slugOfDocumentType("Memorandum of Association") === "memorandum_of_association");
check("Emirates ID", slugOfDocumentType("Copy of Emirates ID") === "copy_of_emirates_id");

// ------------------------------------------------------------------ filling in
{
  const input = composite("Copy of Passport", "Memorandum of Association");
  check("both document items are found", documentItemsOf(input.body as never).length === 2);
  const r = await withEpglDocumentFiles(input, [file("copy_of_passport", 1000), file("memorandum_of_association", 2000)], async () => "SHOULD-NOT-UPLOAD");
  const items = documentItemsOf(r.input?.body as never);
  check("both were filled inline", r.inlined.length === 2 && r.uploaded.length === 0, r);
  check("with base64 content", items.every((i) => typeof i.body?.content === "string" && (i.body!.content as string).length > 0));
  check("and no file id", items.every((i) => i.body?.EPG_File_Id__c === undefined));
  check("the file name travels", items.some((i) => i.body?.fileName === "copy_of_passport.pdf"));
  check("the non-document items are untouched", (r.input?.body as never as { compositeRequest: unknown[] }).compositeRequest.length === 3);
}

// ------------------------------------------------------------- the two-step path
{
  const input = composite("Memorandum of Association");
  const calls: string[] = [];
  const r = await withEpglDocumentFiles(input, [file("memorandum_of_association", 6_270_000)], async (f) => { calls.push(f.key); return "068FW0052eRSdwiYAD"; });
  const item = documentItemsOf(r.input?.body as never)[0]!;
  check("a 6.27 MB file is uploaded first", calls.length === 1 && r.uploaded.length === 1, { calls, r });
  check("the item carries the file id", item.body?.EPG_File_Id__c === "068FW0052eRSdwiYAD");
  check("and NOT the content — that is what the size limit is about", item.body?.content === undefined);
}

// --------------------------------------------------------- what cannot be filled
{
  const input = composite("Copy of Passport", "Trade Licence");
  const r = await withEpglDocumentFiles(input, [file("copy_of_passport", 100)], async () => null);
  const items = documentItemsOf(r.input?.body as never);
  check("a slot with no file is left OFF, not sent hollow", items.length === 1, items);
  check("and is reported so the model can ask again", r.unmatched.includes("Trade Licence"), r.unmatched);
}
{
  const input = composite("Memorandum of Association");
  const r = await withEpglDocumentFiles(input, [file("memorandum_of_association", 6_000_000)], async () => null);
  check("a failed upload drops the slot rather than filing an empty one", documentItemsOf(r.input?.body as never).length === 0);
  check("and says which", r.failed.includes("memorandum_of_association"));
}
{
  // A re-upload the model already put up itself: not ours to overrule.
  const input = { body: { compositeRequest: [{ method: "POST", url: "/services/data/v60.0/sobjects/EPG_Document__c", referenceId: "Doc1", body: { Document_Type: "Something Else", EPG_File_Id__c: "068ALREADY" } }] } };
  const r = await withEpglDocumentFiles(input, [], async () => "NEW");
  check("a file id the model supplied is left alone", documentItemsOf(r.input?.body as never)[0]?.body?.EPG_File_Id__c === "068ALREADY");
}
{
  const r = await withEpglDocumentFiles({ body: { compositeRequest: [] } }, [file("x", 1)], async () => "id");
  check("an empty composite is returned untouched", r.inlined.length === 0 && r.uploaded.length === 0);
}

// ------------------------------------------------------------------- multipart
{
  const f = file("memorandum_of_association", 64, "moa.pdf");
  const { body, contentType } = contentVersionMultipart(f, "7X TEST");
  const text = body.toString("latin1");
  check("the content type announces the boundary", /^multipart\/form-data; boundary=----dialog/.test(contentType), contentType);
  const boundary = contentType.split("boundary=")[1]!;
  check("the boundary is actually used", text.includes(`--${boundary}`));
  check("the metadata part is application/json", /name="entity_content"\r\nContent-Type: application\/json/.test(text));
  // THE BUG THIS ENCODES. A metadata part with a filename makes Salesforce see
  // two binary parts and answer "Cannot include more than one binary part".
  const metaPart = text.split(`--${boundary}`)[1] ?? "";
  check("and carries NO filename — two binary parts is rejected", !/filename=/.test(metaPart), metaPart.slice(0, 120));
  check("the file part does carry one", /name="VersionData"; filename="moa\.pdf"/.test(text));
  check("the bytes are in there", text.includes("A".repeat(64)));
  check("it ends with the closing boundary", text.trimEnd().endsWith(`--${boundary}--`));
}

// ------------------------------------------------- the id the push is keyed on
{
  // Their real create response, as returned by the sandbox on 21 October.
  const real = JSON.stringify({ compositeResponse: [
    { referenceId: "NewAccount", httpStatusCode: 201, body: { id: "001FW00001", success: true } },
    { referenceId: "NewLicenseRequest", httpStatusCode: 200, body: { id: "a11FW000slgt25AYAQ", success: true, applicationId: "LR-54039" } },
    { referenceId: "Doc1", httpStatusCode: 200, body: { id: "a0v", success: true, applicationId: null } },
  ] });
  check("the application id is read off the create response", applicationIdFrom(real) === "LR-54039");
  check("...even behind an HTTP status line", applicationIdFrom(`HTTP 200 OK\n${real}`) === "LR-54039");
  check("a null applicationId on a document item is not mistaken for it", applicationIdFrom(JSON.stringify({ compositeResponse: [{ referenceId: "Doc1", body: { applicationId: null } }] })) === null);
  check("a response with no composite gives nothing", applicationIdFrom(JSON.stringify({ ok: true })) === null);
  check("nonsense gives nothing rather than throwing", applicationIdFrom("not json at all") === null);
  check("an empty result gives nothing", applicationIdFrom(undefined) === null);
  // Their referenceId is a convention in an example, not a contract.
  check("an id under a different referenceId is still found",
    applicationIdFrom(JSON.stringify({ compositeResponse: [{ referenceId: "Renamed", body: { applicationId: "LR-99" } }] })) === "LR-99");
  check("a Salesforce record id is not an application id",
    applicationIdFrom(JSON.stringify({ compositeResponse: [{ referenceId: "NewLicenseRequest", body: { applicationId: "a11FW000slgt25AYAQ" } }] })) === null);
}

// ---------------------------------------------------------------- the wiring
{
  const read = (p: string) => readFileSync(resolve(here, "..", p), "utf8");
  const intg = read("lib/integrations.ts");
  check("the patcher is gated on the 2.0 composite", /isEpglCompositeTool\(toolName\) && opts\.epglDocuments/.test(intg));
  check("the upload is logged like any other outbound call", /trackedFetch\(\s*`\$\{entry\.spec\.baseUrl\}\/services\/data\/v60\.0\/sobjects\/ContentVersion`/.test(intg));
  check("a missing document is reported alongside the success", /if \(documentNote && !res\.isError\)/.test(intg));
  check("1.x still strips its documents", /withoutEpglDocuments\(input\) \?\? input/.test(intg));

  check("the id is captured after a successful composite", /isEpglCompositeTool\(toolName\) && opts\.rememberEpglApplicationId/.test(intg));
  check("and losing it never costs the turn", /Losing the id costs the push, not the submission/.test(intg));

  const route = read("app/api/chat/route.ts");
  check("only EPGL gets the provider", /epglDocuments:\s*\n\s*agent\.definition\.tenantSlug === "epgl"/.test(route));
  check("it reads raw bytes, not base64", /bytes: stored\.bytes/.test(route));
  // THE WHOLE POINT: the key the status receiver looks the case up by.
  check("the id is written to state.data.application_id", /data: \{ \.\.\.st\.data, application_id: applicationId \}/.test(route));
  const push = read("app/api/epgl/status/route.ts");
  check("which is exactly what the status push matches on", /'data' ->> 'application_id'/.test(push));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
