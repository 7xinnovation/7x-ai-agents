/**
 * The documents that did not reach LR-54110 (3 November 2026).
 *
 * Reported from a pack-07 run: "no re-uploads are needed … however, four
 * documents need to be re-sent", then "the document attachment hit a technical
 * snag on our side". The audit trail for that conversation:
 *
 *   epgl_documents_attached  {"via":"create","sent":["beneficial_ownership_declaration"]}
 *   CompositeHandler         {"allOrNone":false,"compositeRequest":[]}
 *                            → "List index out of bounds: -1 | Class.CompositeHandler.handleRequest"
 *   epgl_documents_failed    {"attempted":["moa","partner_1_passport","partner_1_emirates_id"],"sent":[]}
 *
 * Three faults in a row, one test file:
 *   1. the model wrote ONE document item, so the injector stood down and six
 *      uploaded documents never travelled with the create;
 *   2. the follow-up push looked its files up by the slug of Document_Type, so
 *      our own slot keys never matched and every item was dropped;
 *   3. the empty composite left behind was sent anyway.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-documents-lost-2026-11-03.ts
 */
import {
  withEpglDocumentItems,
  withEpglDocumentFiles,
  documentCompositeBody,
  type EpglCaseFile,
  type CompositeItem,
} from "@/lib/epglComposite";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got)}`}`); }
};

const file = (key: string, salesforceType?: string, extra: Partial<EpglCaseFile> = {}): EpglCaseFile => ({
  key,
  fileName: `${key}.pdf`,
  bytes: new Uint8Array([37, 80, 68, 70]),
  salesforceType,
  ...extra,
});

/** What the pack-07 run actually held, by the slot keys in its audit rows. */
const PACK07: EpglCaseFile[] = [
  file("trade_license", "Trade Licence"),
  file("moa", "Memorandum of Association"),
  file("partner_1_passport", "Copy of Passport"),
  file("partner_1_emirates_id", "Copy of Emirates ID"),
  file("partner_2_passport", "Copy of Passport"),
  file("partner_2_emirates_id", "Copy of Emirates ID"),
  file("beneficial_ownership_declaration", "Beneficial Ownership Declaration"),
];

const item = (url: string, referenceId: string, body: Record<string, unknown> = {}): CompositeItem =>
  ({ method: "POST", url: `/services/data/v60.0/sobjects/${url}`, referenceId, body });

/** The create, with the one document item the model wrote for itself. */
const createWithOneDoc = () => ({
  body: {
    allOrNone: true,
    compositeRequest: [
      item("Account", "NewAccount", { Name: "7X TEST SWIFT POST" }),
      item("Contact", "NewContact", { AccountId: "@{NewAccount.id}" }),
      item("EPG_License_Request__c", "NewLicenseRequest", { Product_Code: "CEP30-UAE-SME-DOM" }),
      item("EPG_Document__c", "Doc1", { Document_Type: "Beneficial Ownership Declaration", content: "JVBE" }),
    ],
  },
});

const docItems = (input: unknown) =>
  (((input as { body?: { compositeRequest?: CompositeItem[] } })?.body?.compositeRequest ?? []) as CompositeItem[])
    .filter((i) => /EPG_Document__c$/.test(String(i.url)));
const typesOf = (input: unknown) =>
  docItems(input).map((i) => String((i.body as Record<string, unknown>)?.Document_Type ?? ""));

console.log("\n1 · one item from the model no longer stands the rest down");
/**
 * Up to the per-call limit (4 November, MAX_DOCUMENTS_PER_CALL = 4): EPGL's
 * Apex runs out of queries past a handful of documents in one call. The model
 * wrote one, so three are added; the other three are left unsent and go on
 * the follow-up. Before the limit this asserted all seven on the create.
 */
const injected = withEpglDocumentItems(createWithOneDoc(), PACK07);
check("three more are added beside the model's one", injected.added.length === 3, injected.added);
check("the create carries four documents, the per-call limit", docItems(injected.input).length === 4, typesOf(injected.input));
check("the model's own item is kept, once", typesOf(injected.input).filter((t) => t === "Beneficial Ownership Declaration").length === 1, typesOf(injected.input));
check("the declaration is not added a second time", !injected.added.includes("beneficial_ownership_declaration"), injected.added);
check("no referenceId is used twice",
  new Set(docItems(injected.input).map((i) => i.referenceId)).size === 4,
  docItems(injected.input).map((i) => i.referenceId));
check("and none of them collides with the model's Doc1",
  injected.added.length === 3 && !docItems(injected.input).some((i, n, all) => all.findIndex((x) => x.referenceId === i.referenceId) !== n));
check("every added item is bound to the licence request",
  docItems(injected.input).filter((i) => (i.body as Record<string, unknown>).EPG_License_Request__c === "@{NewLicenseRequest.id}").length === 3);

console.log("\n...and what it still leaves alone");
const noRequest = withEpglDocumentItems({ body: { compositeRequest: [item("Account", "NewAccount")] } }, PACK07);
check("a composite with no licence request in it", noRequest.added.length === 0);
check("no files at all", withEpglDocumentItems(createWithOneDoc(), []).added.length === 0);
const allCovered = withEpglDocumentItems(
  {
    body: {
      compositeRequest: [
        item("EPG_License_Request__c", "NewLicenseRequest", {}),
        ...PACK07.map((f, i) => item("EPG_Document__c", `D${i}`, { Document_Type: f.salesforceType })),
      ],
    },
  },
  PACK07
);
check("a model that composed the whole set itself", allCovered.added.length === 0, allCovered.added);
const undated = withEpglDocumentItems(
  { body: { compositeRequest: [item("EPG_License_Request__c", "NewLicenseRequest", {})] } },
  [file("lease_contract", "Lease Contract", { validityRequired: true })]
);
check("a slot EPGL will refuse for want of a date stays off the create", undated.added.length === 0);

console.log("\n2 · the follow-up push finds its files");
const slots = ["moa", "partner_1_passport", "partner_1_emirates_id"].map((k) => {
  const f = PACK07.find((x) => x.key === k)!;
  return { key: k, salesforceType: f.salesforceType };
});
const push = documentCompositeBody("LR-54110", slots);
check("the body is built with three items", docItems({ body: push }).length === 3);

const filled = await withEpglDocumentFiles({ body: push! }, PACK07, async () => null);
check("none is dropped as unmatched", filled.unmatched.length === 0, filled.unmatched);
check("all three carry their bytes", filled.inlined.length === 3, filled.inlined);
check("the composite is NOT empty", docItems(filled.input).length === 3, docItems(filled.input).length);
check("moa found its file", filled.inlined.includes("moa"), filled.inlined);
check("so did partner_1_passport, whose type slugs to copy_of_passport", filled.inlined.includes("partner_1_passport"), filled.inlined);

console.log("\n...and the slot key still wins over EPGL's name for it");
const twins: EpglCaseFile[] = [
  file("copy_of_passport", "Copy of Passport", { fileName: "catalogue-twin.pdf" }),
  file("partner_1_passport", "Copy of Passport", { fileName: "ours.pdf" }),
];
const byKeyBody = documentCompositeBody("LR-1", [{ key: "copy_of_passport", salesforceType: "Copy of Passport" }]);
const twinFilled = await withEpglDocumentFiles({ body: byKeyBody! }, twins, async () => null);
check("a catalogue slot takes the catalogue slot's file", twinFilled.inlined[0] === "copy_of_passport", twinFilled.inlined);
check("a file with no salesforceType is still reachable by its key",
  (await withEpglDocumentFiles(
    { body: { compositeRequest: [item("EPG_Document__c", "Doc1", { Document_Type: "Trade Licence" })] } },
    [file("trade_licence", undefined), file("trade_license", "Trade Licence")],
    async () => null
  )).inlined.length === 1);
const genuinelyMissing = await withEpglDocumentFiles(
  { body: { compositeRequest: [item("EPG_Document__c", "Doc1", { Document_Type: "Something Nobody Holds" })] } },
  PACK07,
  async () => null
);
check("a type we hold no file for is still reported unmatched", genuinelyMissing.unmatched.length === 1, genuinelyMissing.unmatched);

console.log("\n...and two slots sharing one of EPGL's names get a file each");
// Since 5 November partner 2 travels only with its Holder (test-partner-holder).
const SARA = "Sara Al Hashimi";
const bothPassports = documentCompositeBody("LR-54110", [
  { key: "partner_1_passport", salesforceType: "Copy of Passport" },
  { key: "partner_2_passport", salesforceType: "Copy of Passport", holder: SARA },
]);
const withHolder = PACK07.map((f) => (f.key.startsWith("partner_2_") ? { ...f, holder: SARA } : f));
const pair = await withEpglDocumentFiles({ body: bothPassports! }, withHolder, async () => null);
check("both are filled", pair.inlined.length === 2, pair.inlined);
check("and with DIFFERENT files", new Set(pair.inlined).size === 2, pair.inlined);
check("partner 1 first, partner 2 second", pair.inlined.join(",") === "partner_1_passport,partner_2_passport", pair.inlined);
const names = docItems(pair.input).map((i) => (i.body as Record<string, unknown>).fileName);
check("the file names differ too", new Set(names).size === 2, names);

console.log("\n3 · nothing to send is not a call");
check("no sendable slot builds no body at all", documentCompositeBody("LR-54110", []) === null);
check("...nor does a slot with no salesforceType", documentCompositeBody("LR-1", [{ key: "moa" }]) === null);
check("...nor one refused for want of a date",
  documentCompositeBody("LR-1", [{ key: "lease", salesforceType: "Lease Contract", validityRequired: true }]) === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
