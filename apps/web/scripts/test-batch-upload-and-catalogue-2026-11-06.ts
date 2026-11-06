/**
 * EPGL 2.0, 6 November 2026: the licence menu is the catalogue every time, and
 * "Upload all at once" exists.
 *
 * Against the staging definition's journeys (scripts/fixtures) and the three
 * menus the model actually wrote across 17 sessions.
 *
 * Run from apps/web:  npx tsx scripts/test-batch-upload-and-catalogue-2026-11-06.ts
 */
import { readFileSync } from "node:fs";
import type { AgentDefinition, CaseState } from "@dialog/config";
import { slotPrompt, parseSlotChoice } from "@dialog/core";
import {
  productOptions, canonicalProductBlock, isProductMenu, productCardGuard, chainGuards,
} from "@/lib/productCards";
import {
  offersBatch, uploadModeFrom, batchCandidates, assignPartnerSlot, missingDocuments, modeChoiceDirective,
  batchStartDirective, batchReportDirective, productFirstDirective, MODE_LABELS,
} from "@/lib/batchUpload";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n       ${JSON.stringify(got).slice(0, 400)}`}`); }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const def = JSON.parse(read("./fixtures/epgl-dialog-2.stg.2026-11-06.json")) as AgentDefinition;
const state = (data: Record<string, unknown>, documents: CaseState["documents"] = []): CaseState =>
  ({ journeyKey: "new_license", data, documents, readiness: { ready: false, missing: [] } } as unknown as CaseState);

console.log("\n1 · the licence menu is the catalogue");
const opts = productOptions(def, "en");
check("ten products, from the product_code field", opts.length === 10, opts.map((o) => o.code));
check("in catalogue order", opts[0]!.code === "CEP30-UAE-SME-DOM" && opts[9]!.code === "OUTSOURCE", opts.map((o) => o.code));
check("Arabic labels in Arabic", /[؀-ۿ]/.test(productOptions(def, "ar")[0]!.label));
check("nothing for an agent that is not EPGL", productOptions({ ...def, tenantSlug: "nxn" } as AgentDefinition, "en").length === 0);

// The three menus the model wrote (abridged from the transcripts).
const FULL = "```cards\n" + opts.map((o) => `- title: ${o.label}\n  desc: x\n  key: ${o.code}`).join("\n") + "\n```";
const GROUPED = "```cards\n- title: CEP Licence (≤30 kg) — UAE-national-owned SME\n  desc: Domestic only, or Domestic and International\n  badge: SME\n- title: CEP Licence (≤30 kg) — Non-UAE-national-owned SME\n  desc: Domestic only, or Domestic and International\n- title: CEP Licence (≤30 kg) — General\n  desc: Domestic only, or Domestic and International\n- title: Food and Medicine Delivery\n  desc: FOODMED licence\n- title: Electronic Lockers Service and PUDO\n  desc: LOCKERS permit\n```";
const SPLIT = "```cards\n- title: CEP Licence (≤30 kg) — UAE-national-owned SME\n  desc: Domestic only\n- title: CEP Licence (≤30 kg) — UAE-national-owned SME\n  desc: Domestic and International\n- title: Outsourcing Services\n  desc: OUTSOURCE permit\n```";
const BRANCHES = "```cards\n- title: Al Barsha Post Office\n  desc: Dubai\n- title: Deira Post Office\n  desc: Dubai\n```";
for (const [n, b] of [["the full menu", FULL], ["the grouped seven", GROUPED], ["the split-scope menu", SPLIT]] as const)
  check(`${n} is recognised as the licence menu`, isProductMenu(b, opts));
check("a branch menu is not", !isProductMenu(BRANCHES, opts));
const canon = canonicalProductBlock(opts);
check("the canonical block has all ten codes as keys", opts.every((o) => canon.includes(`key: ${o.code}`)));
check("...and no two cards share a title", new Set([...canon.matchAll(/title: (.+)/g)].map((m) => m[1])).size === 10);

const stream = (text: string, size: number) => {
  const g = chainGuards(productCardGuard(() => opts), { push: (d: string) => d, flush: () => "" });
  let out = "";
  for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size));
  return out + g.flush();
};
const reply = `Which licence are you applying for?\n\n${GROUPED}\n\nTap one.`;
for (const size of [1, 7, 64, 4096]) {
  const out = stream(reply, size);
  check(`streamed in ${size}-char pieces, the grouped menu becomes the ten`, out.includes(canon) && !out.includes("Domestic only, or") && out.startsWith("Which licence") && out.endsWith("Tap one."), out.slice(0, 200));
}
check("a branch menu streams through untouched", stream(`Pick:\n${BRANCHES}\n`, 5) === `Pick:\n${BRANCHES}\n`);
check("an unclosed menu at the very end is still replaced", stream(`Pick:\n${GROUPED.replace(/\n```$/, "")}`, 9).includes(canon));

console.log("\n2 · the order: licence, then the way, then documents");
check("offered on the EPGL 2.0 new licence", offersBatch(def, "new_license") && offersBatch(def, null));
check("not on renewal", !offersBatch(def, "renewal"));
check("not on NXN", !offersBatch({ ...def, tenantSlug: "nxn" } as AgentDefinition, null));
check("the licence directive forbids an upload before it", /do NOT add an ```upload block/.test(productFirstDirective()) && /comes FIRST/.test(productFirstDirective()));
const choice = modeChoiceDirective("en");
check("the choice is two buttons with the agreed names", choice.includes("- Upload all at once\n- One at a time"));
check("...and asks for no document yet", /Do not ask for a document/.test(choice));
check("the buttons read back as the modes", uploadModeFrom("Upload all at once") === "batch" && uploadModeFrom("One at a time") === "manual");
check("...in Arabic too", uploadModeFrom(MODE_LABELS.batch.ar) === "batch" && uploadModeFrom(MODE_LABELS.manual.ar) === "manual");
check("...and in their own words", uploadModeFrom("can I just upload everything at once?") === "batch" && uploadModeFrom("one by one please") === "manual");
check("an unrelated reply is neither", uploadModeFrom("Yes, all correct") === null && uploadModeFrom("CEP30-UAE-SME-DOM") === null);

console.log("\n3 · where a batch file may go");
const chosen = { product_code: "CEP30-UAE-SME-DOM", product_family: "CEP30", product_is_sme: true };
const before = batchCandidates(def, state(chosen), "en");
const keys = before.map((c) => c.key);
check("the CEP30 documents are offered", ["trade_license", "beneficial_ownership_declaration", "lease_contract", "sme_licence_federal_or_local_government", "operational_standards_self_declaration"].every((k) => keys.includes(k)), keys);
check("the 'Initial Name Approval' is NOT — the trade licence fills it", !keys.includes("trade_licence_initial_name_approval"), keys);
check("before the partners are known: ONE generic passport and ONE Emirates ID", keys.filter((k) => /^partner_\d+_passport$/.test(k)).join() === "partner_1_passport" && keys.filter((k) => /^partner_\d+_emirates_id$/.test(k)).join() === "partner_1_emirates_id", keys);
check("...labelled as any partner's", /any partner/.test(before.find((c) => c.key === "partner_1_passport")!.label));
const partners = { ...chosen, partner_count: "2", partner_1_name: "Ahmed Al Mansoori", partner_2_name: "Sara Al Hashimi", partner_1_type: "person", partner_2_type: "person", company_legal_form: "LLC" };
const after = batchCandidates(def, state(partners), "en");
check("once known, each partner's slots carry the partner's name",
  after.find((c) => c.key === "partner_2_passport")?.holder === "Sara Al Hashimi" && after.find((c) => c.key === "partner_1_emirates_id")?.holder === "Ahmed Al Mansoori",
  after.filter((c) => c.key.startsWith("partner")));
check("...and no slot for a third partner", !after.some((c) => c.key.startsWith("partner_3_")));
check("a General product offers no SME licence", !batchCandidates(def, state({ product_code: "CEP30-GEN-DOM", product_family: "CEP30", product_is_sme: false }), "en").some((c) => c.key.startsWith("sme_licence")));

console.log("\n4 · which partner a passport belongs to");
const docs = (k: string[]) => k.map((key) => ({ key, status: "uploaded" }));
check("by the printed name", assignPartnerSlot("partner_1_passport", "SARA AL HASHIMI", partners, [], []) === "partner_2_passport");
check("name order and case do not matter", assignPartnerSlot("partner_1_passport", "Hashimi Al Sara", partners, [], []) === "partner_2_passport");
check("the classifier's own slot stands when the name says so", assignPartnerSlot("partner_2_emirates_id", "Sara Al Hashimi", partners, [], []) === "partner_2_emirates_id");
check("names unknown: the first free slot", assignPartnerSlot("partner_1_passport", "Sara Al Hashimi", chosen, [], []) === "partner_1_passport");
check("...and a second passport in the same batch takes the next", assignPartnerSlot("partner_1_passport", "Ahmed", chosen, [], ["partner_1_passport"]) === "partner_2_passport");
check("...or the next after one already on the case", assignPartnerSlot("partner_1_passport", undefined, chosen, docs(["partner_1_passport"]), []) === "partner_2_passport");
check("a stranger's passport never takes a named partner's slot",
  assignPartnerSlot("partner_1_passport", "Somebody Else", partners, [], []) === "partner_3_passport");
check("a non-identity slot is left as chosen", assignPartnerSlot("lease_contract", undefined, partners, [], []) === "lease_contract");

console.log("\n5 · the classifier's question and answer");
const prompt = slotPrompt(after);
check("it lists this application's slots by key", after.every((c) => prompt.includes(`"${c.key}"`)));
check("...with whose each identity slot is", prompt.includes("partner_2_passport\": Copy of Passport — belonging to Sara Al Hashimi") || /partner_2_passport": .*belonging to Sara Al Hashimi/.test(prompt), prompt.slice(0, 300));
check("...and prefers no answer to a wrong one", /A wrong slot is worse than none/.test(prompt));
check("an answer naming a listed key is taken", parseSlotChoice('{"key":"lease_contract","why":"Ejari"}', after).key === "lease_contract");
check("one naming a key not offered is NOT", parseSlotChoice('{"key":"made_up"}', after).key === null);
check("null is null", parseSlotChoice('{"key":null,"why":"a holiday photo"}', after).key === null);
check("prose around the JSON is tolerated", parseSlotChoice('Sure: {"key":"moa","holderName":""}', [{ key: "moa", label: "MOA" }]).key === "moa");
check("garbage is no slot, not a crash", parseSlotChoice("I think it is a lease", after).key === null);

console.log("\n6 · what the applicant is told");
const missing = missingDocuments(def, state(partners), "en");
check("the start lists what is missing, and ends in the batch control", /```upload\nkey: batch\n```/.test(batchStartDirective(missing, "en")) && missing.length > 3, missing.map((m) => m.label));
const report = batchReportDirective({ placed: [{ file: "08-lease.pdf", key: "lease_contract" }], unplaced: [{ file: "holiday.jpg" }] }, [{ label: "SME Licence" }], (k) => (k === "lease_contract" ? "Lease Contract" : k));
check("the report names what was found, by document and file", report.includes("Lease Contract (08-lease.pdf)"));
check("...what was not recognised", report.includes("holiday.jpg"));
check("...what is still missing, with one batch control for it", report.includes("SME Licence") && /```upload\nkey: batch\n```/.test(report));
check("...and asks only for what the documents did not answer", /ask only for that, never for something already read off a document/.test(report));
check("nothing missing: no control", !/```upload/.test(batchReportDirective({ placed: [], unplaced: [] }, [], (k) => k)));

console.log("\n7 · it is wired");
const route = read("../app/api/chat/route.ts");
const upload = read("../app/api/upload/route.ts");
const md = read("../app/embed/[agent]/Markdown.tsx");
const exp = read("../app/embed/[agent]/Experience.tsx");
check("the chat route runs the menu guard ahead of the duration guard", /chainGuards\(\s*productCardGuard\(/.test(route));
check("...states the licence first, the choice, the start and the report", ["productFirstDirective()", "modeChoiceDirective(loc)", "batchStartDirective(", "batchReportDirective("].every((x) => route.includes(x)));
check("...records the chosen mode on the case", /\[UPLOAD_MODE_KEY\]: mode/.test(route));
check("...and clears the batch log once reported", /\[BATCH_LOG_KEY\]: _done/.test(route));
check("the upload route places a batch file, then runs the ordinary path", /if \(key === BATCH_KEY\)/.test(upload) && /key = placedKey;/.test(upload));
check("...settling the partner under the row lock", /mutateCase\(caseRow\.caseId, \(st\) => \{[\s\S]{0,300}assignPartnerSlot/.test(upload));
check("the widget renders for `key: batch` and takes several files", /key\\s\*:\\s\*batch/.test(md) && /<BatchUpload/.test(md) && /\bmultiple\b/.test(md));
check("the browser posts each file as __batch__", /fd\.append\("key", "__batch__"\)/.test(exp));
check("...and holds the poll off while the batch runs", /add\("__batch__"\)/.test(exp));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
