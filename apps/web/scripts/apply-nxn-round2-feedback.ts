/**
 * Applies NXN Round-2 feedback (feedback-export-2026-07-28) to the nxn-dialog
 * agent definition. Comment → change map:
 *
 *  FB-1425 (CRITICAL) upload component not rendering
 *      → documentsInChat=true + guidance teaches the exact ```upload block for
 *        agent EID front/back and the Tier-3 trade license (the widget only
 *        renders when the block is emitted; the chat route also appends the
 *        block deterministically as a fallback).
 *  FB-1428 remove pre-selections → entry guidance no longer pre-fills/shortcuts
 *        bundle/branch/duration; nothing is pre-selected (global prompt rule too).
 *  FB-1376 preferred branch → the customer's usual branch may be badged, never
 *        pre-selected (customer context supplies it).
 *  FB-1430 key delivery fee shown BEFORE selection (fee constant below).
 *  FB-1431 mandatory T&C checkbox before payment (terms_accepted field on all
 *        chargeable journeys; request_payment refuses server-side without it).
 *  FB-1432 map location option for the company address (```locate block).
 *  FB-1427 renewal expiry for expired boxes → grace-period rule: BASE YEAR =
 *        max(expiry year, current year); new expiry always ≥ one full year.
 *  FB-1396 receipt download / email at completion (receipt link is appended by
 *        the route; email via the send_confirmation_email tool).
 *  FB-1426 never claim an email was sent unless the tool returned SENT.
 *  FB-1374/FB-1395 signed-in contact details (mobile/email) prefilled from the
 *        profile — never re-typed.
 *  FB-1398 nearest branch on request → branch cards + ```map block (persona-level
 *        so it works outside an active journey too).
 *
 * Idempotent (marker-guarded / replace-or-skip). Run from apps/web:
 *   npx tsx scripts/apply-nxn-round2-feedback.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

// Courier fee for PO Box key delivery, disclosed BEFORE the customer chooses
// (FB-1430). Business constant — confirm against the official Emirates Post
// tariff before production and update here + in the KB if it differs.
const KEY_DELIVERY_FEE = "AED 25";

// Public Terms & Conditions page linked from the mandatory pre-payment checkbox
// (FB-1431). Confirm the exact URL with NXN/EPG before production.
const TERMS_URL = "https://www.emiratespost.ae/en/terms-and-conditions";

const MARKER = "ROUND 2 FEEDBACK RULES";

const TC_BLOCK_RULE =
  "NEXT, before any payment, present the MANDATORY Terms and Conditions acknowledgment as its own fenced block: three backticks then `toggles`, then `style: checkbox`, then `- terms_accepted: I have read and agree to the [Terms and Conditions](" +
  TERMS_URL +
  ")`, then `confirm: Agree and continue`, then a closing line of three backticks. Only after the customer confirms, record it with collect_field(terms_accepted, true) — the acceptance timestamp is stamped automatically — and then call request_payment (the server refuses payment until terms_accepted is recorded).";

// Appended to every chargeable journey's guidance (marker-guarded).
const ROUND2_COMMON = [
  `${MARKER} (2026-07-28):`,
  "- NO PRE-SELECTION: emirate, branch, box number, bundle and duration are always presented UNSELECTED — the customer makes every choice. For a returning customer you may add a badge like \"Your usual branch\" to their known branch, but never pre-pick it, never mark anything \"Selected\" before they choose, and never say \"I've selected X for you\".",
  "- CONTACT FROM PROFILE: when the customer is signed in and contact details are on file (see the known customer record), record contact_phone / contact_email with collect_field from the profile and ask ONLY for a quick confirmation — never ask a signed-in customer to type their mobile number or email.",
  "- EMAIL HONESTY: use the send_confirmation_email tool for any email. Only say an email was sent if the tool returned SENT; if it failed, say so and offer the receipt download link instead. If the customer says no email arrived, offer to resend (call the tool again).",
  "- RECEIPT: after a paid submission a receipt download link is appended to your message automatically — point the customer to it and offer to email the receipt too.",
].join("\n");

const ROUND2_RENEWAL_EXTRA =
  "- GRACE PERIOD / NEW EXPIRY (expired boxes): a renewal ALWAYS grants at least one full year of service. If the box's currentExpiryDate is already in the past, compute the new expiry from the CURRENT year instead of the lapsed expiry year (see the pricing notes), and clearly state the resulting NEW expiry date in the summary BEFORE payment and again at completion.";

function replaceOnce(journeyKey: string, guidance: string, find: string, repl: string, log: string[]): string {
  if (guidance.includes(repl)) return guidance; // already applied
  if (!guidance.includes(find)) {
    log.push(`  ! ${journeyKey}: target text not found for: "${find.slice(0, 60)}..."`);
    return guidance;
  }
  return guidance.replace(find, repl);
}

const termsField = {
  key: "terms_accepted",
  type: "boolean",
  label: { en: "Terms and Conditions accepted", ar: "الموافقة على الشروط والأحكام" },
  validation: { required: false },
};

async function main() {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  const def = agent.definition as Record<string, any>;
  const warnings: string[] = [];
  const J = (key: string) => def.journeys.find((j: any) => j.key === key);

  // ── FB-1425: uploads live in the conversation ──
  def.documentsInChat = true;

  // ── FB-1398: nearest-branch answers work outside an active journey too ──
  const PERSONA_MARK = "Nearest branch requests:";
  if (!String(def.persona ?? "").includes(PERSONA_MARK)) {
    def.persona =
      String(def.persona ?? "") +
      " Nearest branch requests: whenever the customer asks for the nearest/closest branch or where to find a branch, ask (or infer) their emirate, call the Rental/BoxLocations tool for it (use bundle MYHOME3 if no bundle is in play), and reply with the branch CARDS followed by the ```map fenced block (a line `map`, a line `emirate: <code>`, a line `bundle: <bundle_Id>`) so they can see the nearest branches to their location on a map.";
  }

  // ── terms_accepted field on every chargeable journey (FB-1431) ──
  const termsTargets: [string, string][] = [
    ["personal_po_box_rental", "contact"],
    ["corporate_po_box_rental", "delivery"],
    ["personal_po_box_renewal", "identify"],
    ["corporate_po_box_renewal", "identify"],
  ];
  for (const [jk, stepKey] of termsTargets) {
    const j = J(jk);
    const step = j?.steps.find((s: any) => s.key === stepKey);
    if (!step) { warnings.push(`  ! ${jk}: step ${stepKey} not found for terms_accepted`); continue; }
    if (!step.fields.some((f: any) => f.key === "terms_accepted")) step.fields.push(termsField);
  }

  // ── Payment stage: T&C checkbox before request_payment (all four) ──
  const PAY_FIND =
    "When the customer proceeds, record save_card_consent and auto_renew_consent with collect_field from the toggle results, mark auto-renew ACTIVE in the submission if it was on, then call request_payment.";
  const PAY_REPL =
    "When the customer proceeds, record save_card_consent and auto_renew_consent with collect_field from the toggle results and mark auto-renew ACTIVE in the submission if it was on. " +
    TC_BLOCK_RULE;
  for (const jk of ["personal_po_box_rental", "corporate_po_box_rental", "personal_po_box_renewal", "corporate_po_box_renewal"]) {
    const j = J(jk);
    if (!j) { warnings.push(`  ! journey ${jk} not found`); continue; }
    j.guidance = replaceOnce(jk, j.guidance ?? "", PAY_FIND, PAY_REPL, warnings);
  }

  // ── Rent Personal ──
  {
    const j = J("personal_po_box_rental");
    let g: string = j.guidance ?? "";
    g = replaceOnce(j.key, g,
      "For a returning customer, pre-fill bundle, branch and duration from their prior choices where known and shortcut the steps.",
      "For a returning customer you may reference their usual choices (e.g. a \"Your usual branch\" badge), but NEVER pre-select or skip a selection on their behalf — every choice is made by the customer.",
      warnings);
    g = replaceOnce(j.key, g,
      "If yes, ask the customer to upload the agent's Emirates ID front AND back in the two upload slots that appear (agent_eid_front, agent_eid_back — both sides required).",
      "If yes, emit TWO upload blocks in that same reply — the upload fields appear ONLY when you emit them: a fenced block of three backticks + `upload`, a line `key: agent_eid_front`, closing backticks; then the same with `key: agent_eid_back` (both sides required).",
      warnings);
    g = replaceOnce(j.key, g,
      "Stage 3 Key Delivery (OPTIONAL): ask 'Deliver the key to an address?' (show its price).",
      `Stage 3 Key Delivery (OPTIONAL): present both options WITH the fee visible BEFORE the customer chooses — "Collect from branch" (free) and "Deliver to address" (${KEY_DELIVERY_FEE} courier fee) as cards/buttons that carry the fee. Never reveal the delivery fee only at payment. If delivery is chosen, include the ${KEY_DELIVERY_FEE} line in the review summary and add it to the payment total.`,
      warnings);
    g = replaceOnce(j.key, g,
      "Stage 6 Completion: confirm the PO Box is rented, then offer receipt, tax invoice, email confirmation and related services.",
      "Stage 6 Completion: confirm the PO Box is rented and give the reference number. A receipt download link is appended to your message automatically. Offer to email the confirmation/receipt via send_confirmation_email (to the contact email on file) — only claim it was sent when the tool returns SENT.",
      warnings);
    if (!g.includes(MARKER)) g += `\n\n${ROUND2_COMMON}`;
    j.guidance = g;
  }

  // ── Rent Corporate ──
  {
    const j = J("corporate_po_box_rental");
    let g: string = j.guidance ?? "";
    g = replaceOnce(j.key, g,
      "Tier 3 — if still no match or not found, ask the customer to upload the trade license copy and route into the existing form-based manual validation (Salesforce case, flagged pending validation).",
      "Tier 3 — if still no match or not found, ask the customer to upload the trade license copy by emitting an upload block in that same reply (three backticks + `upload`, a line `key: trade_license`, closing backticks — the upload field appears ONLY when you emit the block), and route into the existing form-based manual validation (Salesforce case, flagged pending validation). The uploaded license is saved with the application and attached to the PO Box record on submission.",
      warnings);
    g = replaceOnce(j.key, g,
      "Stage 3 Company Address: capture the company address.",
      "Stage 3 Company Address: ask for the company address AND, in the same reply, emit a location-picker block (three backticks + `locate`, closing backticks) so the customer can pin the company location on a map instead of typing — same option the website and app offer. Accept either the typed address or the shared map location (address + coordinates).",
      warnings);
    g = replaceOnce(j.key, g,
      "Stage 4 Add Agent (OPTIONAL): same as the personal journey — record add_agent; if yes, the agent's Emirates ID front AND back are uploaded (agent_eid_front, agent_eid_back) and auto-extracted to pre-fill name / ID number / expiry (confirm with the customer; manual entry only if extraction fails), then email + phone.",
      "Stage 4 Add Agent (OPTIONAL): same as the personal journey — record add_agent; if yes, emit TWO upload blocks in that same reply (three backticks + `upload` with `key: agent_eid_front`, then another with `key: agent_eid_back`) — the upload fields appear only when you emit them. The uploads are auto-extracted to pre-fill name / ID number / expiry (confirm with the customer; manual entry only if extraction fails), then email + phone.",
      warnings);
    g = replaceOnce(j.key, g,
      "Stage 5 Key Delivery (OPTIONAL): offer the company address, or take a different delivery address.",
      `Stage 5 Key Delivery (OPTIONAL): present the options WITH the fee visible BEFORE the customer chooses — branch collection (free) or delivery to the company/another address (${KEY_DELIVERY_FEE} courier fee). If delivery is chosen, include the ${KEY_DELIVERY_FEE} in the review summary and payment total.`,
      warnings);
    g = replaceOnce(j.key, g,
      "Stage 8 Completion: on the verified path confirm the box is rented.",
      "Stage 8 Completion: on the verified path confirm the box is rented and give the reference; a receipt download link is appended automatically — offer to email it via send_confirmation_email (only claim sent when the tool returns SENT).",
      warnings);
    if (!g.includes(MARKER)) g += `\n\n${ROUND2_COMMON}`;
    j.guidance = g;
  }

  // ── Renewals: grace-period expiry + completion receipt ──
  const NOTES_FIND_A =
    "(a) expiryDate = (the YEAR of currentExpiryDate + the number of renewal years)-12-31T00:00:00 and it MUST be strictly in the future — e.g. currentExpiryDate 2028-08-19 with a 2-year renewal gives '2030-12-31T00:00:00';";
  const NOTES_REPL_A =
    "(a) expiryDate = (BASE YEAR + the number of renewal years)-12-31T00:00:00, where BASE YEAR = the YEAR of currentExpiryDate, or THE CURRENT YEAR if the box has ALREADY EXPIRED (grace-period rule: an expired box still receives the full renewal term, never less than one full year of service) — e.g. currentExpiryDate 2028-08-19 with a 2-year renewal gives '2030-12-31T00:00:00', and a box that expired on 2026-02-03, renewed for 1 year during 2026, gives '2027-12-31T00:00:00'; the date MUST be strictly in the future;";
  for (const jk of ["personal_po_box_renewal", "corporate_po_box_renewal"]) {
    const j = J(jk);
    if (!j) continue;
    const af = j.submission?.apiFlow;
    if (af?.notes) {
      if (!af.notes.includes("BASE YEAR")) {
        if (af.notes.includes(NOTES_FIND_A)) af.notes = af.notes.replace(NOTES_FIND_A, NOTES_REPL_A);
        else warnings.push(`  ! ${jk}: pricing-notes formula sentence not found`);
        af.notes = af.notes.replace(
          /= current expiry advanced by the chosen years, formatted/g,
          "= current expiry advanced by the chosen years (for an ALREADY-EXPIRED box: the CURRENT year advanced by the chosen years — grace rule, minimum one full year), formatted"
        );
        af.notes +=
          " ALWAYS show the customer the resulting NEW expiry date in the pre-payment summary — for an expired box explain the grace rule in one short sentence (e.g. 'your box expired in February, so the renewal runs to 31 Dec 2027').";
      }
    }
    let g: string = j.guidance ?? "";
    if (!g.includes(MARKER)) g += `\n\n${ROUND2_COMMON}\n${ROUND2_RENEWAL_EXTRA}`;
    j.guidance = g;
  }

  await db.update(agents).set({ definition: def as typeof agent.definition }).where(eq(agents.id, agent.id));

  console.log("NXN Round-2 feedback applied:");
  console.log(`  documentsInChat: ${def.documentsInChat}`);
  for (const [jk] of termsTargets) {
    const j = J(jk);
    console.log(`  ${jk}: guidance ${j.guidance.length} chars, terms_accepted ${j.steps.some((s: any) => s.fields.some((f: any) => f.key === "terms_accepted")) ? "present" : "MISSING"}`);
  }
  if (warnings.length) {
    console.log("Warnings (targets that were not found — check for drift):");
    for (const w of warnings) console.log(w);
  } else {
    console.log("All replacement targets matched.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
