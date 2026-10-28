/**
 * A document EPGL will refuse is not a document that is in (28 Oct 2026).
 *
 * On LR-54086 the assistant said "All documents are uploaded" in the same turn
 * that a lease contract and a goods-in-transit insurance certificate were
 * dropped from the submission, because neither carried an expiry and EPGL
 * refuse that kind of slot without one. The applicant was not told and was
 * never asked for the date — the panel ticked both, readiness read complete,
 * and the guard that kept them out of the allOrNone create did its job in
 * silence.
 *
 * The fix is in four places and this checks all of them: the slot stays
 * outstanding, the prompt asks for the date, a tool records what the customer
 * says, and the composite says what it did not send.
 *
 * Run from apps/web:  npx tsx scripts/test-epgl-document-expiry-2026-10-28.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { recomputeReadiness, documentsAwaitingExpiry, setDocument } from "@dialog/core";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), "utf8");

/** A journey shaped like EPGL's: one slot that owes a date, one that does not. */
const agent = {
  journeys: [{
    key: "new_license",
    steps: [{
      key: "documents",
      fields: [],
      documents: [
        { key: "lease_contract", label: { en: "Lease Contract" }, requirement: "mandatory", validityRequired: true },
        { key: "moa", label: { en: "MOA" }, requirement: "mandatory" },
        { key: "optional_thing", label: { en: "Optional" }, requirement: "optional", validityRequired: true },
      ],
    }],
  }],
} as never;

const base = {
  journeyKey: "new_license", currentStep: "documents", data: {}, documents: [],
  readiness: { complete: false, missing: [] }, payment: {}, status: "draft",
} as never;

const withDocs = (docs: { key: string; status: string; validTo?: string }[]) =>
  recomputeReadiness(agent, { ...(base as object), documents: docs } as never);

// ---- readiness ---------------------------------------------------------------
const nothing = withDocs([]);
check("an empty case is missing both mandatory documents",
  nothing.readiness.missing.filter((m) => m.kind === "document").length === 2, nothing.readiness.missing);

const undated = withDocs([
  { key: "lease_contract", status: "uploaded" },
  { key: "moa", status: "uploaded" },
]);
check("a validityRequired document uploaded WITHOUT a date is still missing",
  undated.readiness.missing.some((m) => m.key === "lease_contract"), undated.readiness.missing);
check("...so the case is NOT ready", undated.readiness.complete === false);
check("...and the one that owes no date is satisfied",
  !undated.readiness.missing.some((m) => m.key === "moa"));
check("...reported as a document, so the panel shows it outstanding",
  undated.readiness.missing.find((m) => m.key === "lease_contract")?.kind === "document");
check("...and it is listed once, not twice",
  undated.readiness.missing.filter((m) => m.key === "lease_contract").length === 1);

const dated = withDocs([
  { key: "lease_contract", status: "uploaded", validTo: "2027-12-31" },
  { key: "moa", status: "uploaded" },
]);
check("the same document WITH a date satisfies the slot",
  !dated.readiness.missing.some((m) => m.key === "lease_contract"));
check("...and the case is ready", dated.readiness.complete === true);
check("an accepted document counts the same as an uploaded one",
  withDocs([{ key: "lease_contract", status: "accepted", validTo: "2027-12-31" }, { key: "moa", status: "accepted" }])
    .readiness.complete === true);
check("a rejected file is missing for the ordinary reason, not counted twice",
  withDocs([{ key: "lease_contract", status: "rejected" }, { key: "moa", status: "uploaded" }])
    .readiness.missing.filter((m) => m.key === "lease_contract").length === 1);

// ---- which slots are waiting --------------------------------------------------
check("the waiting list names the undated slot", documentsAwaitingExpiry(agent, undated).join() === "lease_contract");
check("...and is empty once the date is in", documentsAwaitingExpiry(agent, dated).length === 0);
check("...and is empty when nothing has been uploaded", documentsAwaitingExpiry(agent, nothing).length === 0);
check("an OPTIONAL slot that owes a date is listed too — EPGL refuse it just the same",
  documentsAwaitingExpiry(agent, withDocs([{ key: "optional_thing", status: "uploaded" }])).join() === "optional_thing");
check("...but it does not block readiness, because it was never required",
  !withDocs([
    { key: "lease_contract", status: "uploaded", validTo: "2027-12-31" },
    { key: "moa", status: "uploaded" },
    { key: "optional_thing", status: "uploaded" },
  ]).readiness.missing.some((m) => m.key === "optional_thing"));
check("recording the date through setDocument clears it", (() => {
  const doc = undated.documents.find((d) => d.key === "lease_contract")!;
  const after = setDocument(agent, undated, { ...doc, validTo: "2027-12-31" });
  return documentsAwaitingExpiry(agent, after).length === 0 && after.readiness.complete === true;
})());

// ---- the tool ----------------------------------------------------------------
const tools = read("../../../packages/core/src/ai/tools.ts");
check("there is a tool for it", /name: "record_document_expiry"/.test(tools));
check("...which says where the date must come from",
  /Ask the customer for the date on THEIR copy/.test(tools));
check("...and that a period ends on its last day",
  /runs to the end of a period expires on the last day of it/i.test(tools));
check("...and forbids inventing one", /Never guess a date, never copy one from a different document/.test(tools));
const handler = tools.slice(tools.indexOf('case "record_document_expiry"'), tools.indexOf('case "record_document":'));
check("it refuses a slot with no file behind it", /there is no uploaded document under/.test(handler));
check("it refuses anything that is not a real ISO date",
  /is not a date this can use/.test(handler) && /parsed\.toISOString\(\)\.slice\(0, 10\) !== date/.test(handler));
check("...including a day-first date, rather than passing it through",
  /If the customer gave it day-first, convert it/.test(handler));
check("it refuses a date already in the past", /has already passed, so this document has expired/.test(handler));
check("...and says what to do about it instead", /ask for a current one/.test(handler));
check("it writes the date onto the existing file, keeping everything else",
  /setDocument\(agent, state, \{ \.\.\.slot, validTo: date \}\)/.test(handler));
check("it names whatever is still waiting", /Still waiting on a date/.test(handler));
check("...and reports readiness, like the other collectors", /Readiness: \$\{state\.readiness\.complete/.test(handler));

// ---- the prompt ---------------------------------------------------------------
const prompt = read("../../../packages/core/src/ai/prompt.ts");
check("the prompt computes the waiting list", /const awaitingExpiry = documentsAwaitingExpiry\(agent, state\)/.test(prompt));
const note = prompt.slice(prompt.indexOf("WAITING ON AN EXPIRY DATE"), prompt.indexOf("// The one figure the customer must be quoted."));
check("it is listed apart from the uploads", /WAITING ON AN EXPIRY DATE/.test(note));
check("...and does NOT ask for the file again",
  /Do NOT ask for these files again and do NOT show an upload card for them/.test(note));
check("...explains the period rule with a worked example", /means 31-12-2027/.test(note));
check("...names the tool to record it with", /record_document_expiry/.test(note));
check("...keeps one ask per message", /One document per message/.test(note));
check("...and forbids the sentence that caused this",
  /never say it is uploaded, complete, received or "all in"/.test(note));

// ---- the composite backstop -----------------------------------------------------
const intg = read("../lib/integrations.ts");
check("the create says which documents it did not send",
  /THESE DOCUMENTS DID NOT GO TO EMIRATES POST/.test(intg));
check("...computed from the same two conditions the send filter uses",
  /files\.filter\(\(f\) => !!f\.salesforceType && f\.validityRequired && !f\.validTo\)/.test(intg));
check("...and it does not overwrite the note about missing FILES",
  /\$\{documentNote \? `\$\{documentNote\} ` : ""\}/.test(intg));
check("...and tells the model not to ask for the upload again", /do NOT ask them to upload it again: it is here/.test(intg));
check("the send filter itself is unchanged, on both paths",
  (read("../lib/epglComposite.ts").match(/!!\w+\.salesforceType && !\(\w+\.validityRequired && !\w+\.validTo\)/g) ?? []).length === 3);

// ---- the classifier ---------------------------------------------------------------
const extract = read("../../../packages/core/src/ai/extract.ts");
check("the taxonomy now has a name for a lease contract", /"lease_contract",/.test(extract));
check("...and for an insurance certificate", /"insurance_certificate",/.test(extract));
check("...both with customer-facing labels",
  /lease_contract: \{ en: "Lease contract \/ Ejari"/.test(extract) &&
  /insurance_certificate: \{ en: "Insurance certificate"/.test(extract));
check("...and the note says naming them is not the guarantee",
  /The guarantee is elsewhere/.test(extract));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
