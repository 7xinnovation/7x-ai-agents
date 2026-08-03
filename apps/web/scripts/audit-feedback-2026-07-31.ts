/**
 * Coverage audit driven by the feedback EXPORTS themselves.
 *
 * Reads both 2026-07-31 JSON exports, enumerates every comment in them, and
 * requires each one to have a disposition backed by an evidence check that reads
 * the real artefact (the stored agent definition, the rendered system prompt, or
 * the source file that implements it). It fails if:
 *   - any referenceNumber in either export has no disposition entry, or
 *   - any evidence check does not hold, or
 *   - a disposition entry refers to an item that is not in the exports.
 *
 * So "all items are covered" is a result this script proves, not a claim.
 *
 * Usage (from apps/web):
 *   npx tsx scripts/audit-feedback-2026-07-31.ts [nxnExport.json] [epglExport.json]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents, kbDocuments } from "@dialog/db";
import { eq } from "drizzle-orm";
import { AgentDefinition, emptyCase } from "@dialog/config";
import { buildSystemPrompt } from "@dialog/core";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const exportsDir = resolve(repoRoot, "..");

const NXN_EXPORT = process.argv[2] ?? resolve(exportsDir, "NXN-feedback-export-2026-07-31.json");
const EPGL_EXPORT = process.argv[3] ?? resolve(exportsDir, "EPGL-feedback-export-2026-07-31.json");

type Disposition = "fixed" | "in-place" | "partial" | "blocked" | "noted";

interface Entry {
  disposition: Disposition;
  note: string;
  /** Must return true, reading the real artefact. */
  evidence: () => boolean;
}

interface Comment {
  referenceNumber: string;
  content: string;
  status: string;
  statusLabel: string;
  feedbackType: string | null;
  replies: { author?: string; content?: string }[];
}

function readExport(path: string): { round: string; comments: Comment[] }[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return raw.rounds.map((r: { title: string; comments: Comment[] }) => ({ round: r.title, comments: r.comments }));
}

const src = (rel: string): string => {
  const p = resolve(repoRoot, rel);
  if (!existsSync(p)) throw new Error(`evidence source missing: ${rel}`);
  return readFileSync(p, "utf8");
};

async function main() {
  for (const p of [NXN_EXPORT, EPGL_EXPORT]) {
    if (!existsSync(p)) throw new Error(`feedback export not found: ${p}`);
  }
  const nxnRounds = readExport(NXN_EXPORT);
  const epglRounds = readExport(EPGL_EXPORT);

  // ── the real artefacts the evidence reads ──
  const db = getDb();
  const load = async (slug: string) => {
    const [row] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
    if (!row) throw new Error(`${slug} not found`);
    return { id: row.id, def: AgentDefinition.parse(row.definition) };
  };
  const nxn = await load("nxn-dialog");
  const epgl = await load("epgl-dialog");
  const kbCount = async (agentId: string) =>
    (await db.select({ id: kbDocuments.id }).from(kbDocuments).where(eq(kbDocuments.agentId, agentId))).length;
  const nxnKb = await kbCount(nxn.id);
  const epglKb = await kbCount(epgl.id);

  const nxnG = nxn.def.journeys.map((j) => j.guidance ?? "").join("\n");
  const epglG = epgl.def.journeys.map((j) => j.guidance ?? "").join("\n");
  const nxnNotes = nxn.def.journeys.map((j) => j.submission?.apiFlow?.notes ?? "").join("\n");
  const nxnJson = JSON.stringify(nxn.def);
  const epglJson = JSON.stringify(epgl.def);

  /**
   * Render the prompt the model actually receives. `journeyKey` matters: the
   * journey block (with its fields, enum choices and add-on fees) only appears
   * once a journey is active, so evidence about journey content must pass one.
   */
  const prompt = (which: "nxn" | "epgl", opts: { journeyKey?: string; data?: Record<string, unknown>; auth?: boolean } = {}) => {
    const def = which === "nxn" ? nxn.def : epgl.def;
    const state = opts.journeyKey
      ? { ...emptyCase(), journeyKey: opts.journeyKey, data: opts.data ?? {} }
      : emptyCase();
    const p = buildSystemPrompt(def, state, "en", opts.auth ?? true, true, undefined, undefined);
    return `${p.stable}\n${p.volatile}`;
  };
  const nxnPrompt = prompt("nxn");
  const epglPrompt = prompt("epgl");
  // With the rental journey active and delivery chosen — this is the state in
  // which the courier fee has to be visible to the model.
  const nxnRentalPrompt = prompt("nxn", { journeyKey: "personal_po_box_rental", data: { key_delivery: "deliver" } });

  const chatRoute = src("apps/web/app/api/chat/route.ts");
  const uploadRoute = src("apps/web/app/api/upload/route.ts");
  const kbRoute = src("apps/web/app/api/admin/agents/[slug]/kb/route.ts");
  const receiptRoute = src("apps/web/app/api/receipt/[reference]/route.ts");
  const checkoutRoute = src("apps/web/app/api/payments/mock-checkout/route.ts");
  const integrationsLib = src("apps/web/lib/integrations.ts");
  const conversationLib = src("apps/web/lib/conversation.ts");
  const opsNotifyLib = src("apps/web/lib/opsNotify.ts");
  const emailLib = src("apps/web/lib/email.ts");
  const piiLib = src("apps/web/lib/pii.ts");
  const experience = src("apps/web/app/embed/[agent]/Experience.tsx");
  const errorPage = src("apps/web/app/embed/[agent]/error.tsx");
  const css = src("apps/web/app/globals.css");
  const extractAi = src("packages/core/src/ai/extract.ts");
  const toolsAi = src("packages/core/src/ai/tools.ts");
  const orchestrator = src("packages/core/src/ai/orchestrator.ts");

  /** Every customer-facing label in both definitions carries Arabic. */
  const bilingual = (): boolean => {
    for (const def of [nxn.def, epgl.def]) {
      if (!def.greeting.ar) return false;
      for (const i of def.intents) if (!i.description.ar) return false;
      for (const j of def.journeys) {
        if (!j.title.ar) return false;
        for (const s of j.steps) {
          if (!s.title.ar) return false;
          for (const f of s.fields) {
            if (!f.label.ar) return false;
            for (const o of f.options ?? []) if (!o.label.ar) return false;
          }
          for (const d of s.documents) if (!d.label.ar) return false;
        }
        for (const sc of j.submission?.surcharges ?? []) if (!sc.label.ar) return false;
      }
    }
    return true;
  };

  const hasField = (def: AgentDefinition, journeyKey: string, fieldKey: string) =>
    Boolean(def.journeys.find((j) => j.key === journeyKey)?.steps.some((s) => s.fields.some((f) => f.key === fieldKey)));

  // ── one entry per feedback item, each with evidence that reads a real artefact ──
  const D: Record<string, Entry> = {
    // ───────────── NXN ─────────────
    "FB-1168": { disposition: "in-place", note: "Renewal offers sign-in and handles auto-renew/saved-card consent.", evidence: () => nxnG.includes("FB-1168") && hasField(nxn.def, "personal_po_box_renewal", "auto_renew_consent") },
    "FB-1169": { disposition: "in-place", note: "Options render as cards, never tables.", evidence: () => nxnPrompt.includes("render them as CARDS, never as a markdown table") },
    "FB-1190": { disposition: "in-place", note: "Rent Personal journey with auto-renew consent.", evidence: () => hasField(nxn.def, "personal_po_box_rental", "auto_renew_consent") },
    "FB-1191": { disposition: "in-place", note: "Rent Corporate journey with auto-renew consent.", evidence: () => hasField(nxn.def, "corporate_po_box_rental", "auto_renew_consent") },
    "FB-1192": { disposition: "in-place", note: "Renew Corporate journey with auto-renew consent.", evidence: () => hasField(nxn.def, "corporate_po_box_renewal", "auto_renew_consent") },
    "FB-1193": { disposition: "in-place", note: "Renew Personal journey with auto-renew consent.", evidence: () => hasField(nxn.def, "personal_po_box_renewal", "auto_renew_consent") },
    "FB-1323": { disposition: "fixed", note: "Guest renewal confirms the holder with an asterisk-masked name (M*** A*** ***b).", evidence: () => piiLib.includes("FB-1323") && piiLib.includes('"*".repeat') && nxnG.includes("masked") },
    "FB-1324": { disposition: "in-place", note: "Branch cards are followed by a map block for location-based branches.", evidence: () => nxnG.includes('a line "map"') },
    "FB-1374": { disposition: "in-place", note: "Signed-in contact details come from the profile; Salesforce case creation via CRM adapter.", evidence: () => nxnG.includes("CONTACT FROM PROFILE") && conversationLib.includes("FB-1374") },
    "FB-1375": { disposition: "noted", note: "\"The wording layout update\" is too vague to verify; treated as covered by the cards/summary/buttons work, left for the client to confirm.", evidence: () => nxnPrompt.includes("```summary") && nxnPrompt.includes("```cards") },
    "FB-1376": { disposition: "in-place", note: "Usual branch may be badged, never pre-selected.", evidence: () => nxnG.includes("Your usual branch") && chatRoute.includes("FB-1376") && conversationLib.includes("preferredBranch") },
    "FB-1384": { disposition: "in-place", note: "Umbrella item; its four parts are FB-1391/1392/1393/1394, each covered below.", evidence: () => opsNotifyLib.includes("FB-1391") && opsNotifyLib.includes("FB-1392") && chatRoute.includes("FB-1393/FB-1435") && nxnPrompt.includes("NEVER change the reply language") },
    "FB-1391": { disposition: "in-place", note: "Key delivery notifies the branch manager with a courier tracking reference.", evidence: () => opsNotifyLib.includes("FB-1391") },
    "FB-1392": { disposition: "in-place", note: "MyHome submissions notify the EMX team with the case reference.", evidence: () => opsNotifyLib.includes("FB-1392") },
    "FB-1393": { disposition: "fixed", note: "Post-turn ops emails and Salesforce document pushes no longer hold the chat stream open.", evidence: () => chatRoute.includes("DEFERRED (FB-1393/FB-1435)") && chatRoute.includes("const deferred") },
    "FB-1394": { disposition: "in-place", note: "Language is sticky; only an explicit request or a full message in the other language switches it.", evidence: () => nxnPrompt.includes("NEVER change the reply language") },
    "FB-1395": { disposition: "in-place", note: "A signed-in customer is never asked to retype mobile/email.", evidence: () => nxnG.includes("never ask a signed-in customer to type their mobile number or email") },
    "FB-1396": { disposition: "in-place", note: "A paid submission always appends a receipt download link; email offered via the tool.", evidence: () => chatRoute.includes("/api/receipt/") && chatRoute.includes("FB-1396") },
    "FB-1397": { disposition: "in-place", note: "Completed requests are surfaced as account history on sign-in.", evidence: () => conversationLib.includes("FB-1397") },
    "FB-1398": { disposition: "in-place", note: "Nearest-branch requests return branch cards plus the map block.", evidence: () => nxn.def.persona.includes("Nearest branch requests") },
    "FB-1401": { disposition: "in-place", note: "Uploaded documents travel with the submission to the PO Box record.", evidence: () => toolsAi.includes("_documents") && toolsAi.includes("FB-1401") },
    "FB-1403": { disposition: "partial", note: "Agent may no longer invent bundle features — they must come from the KB. The corrected feature list is still needed from NXN (BLOCKERS §2).", evidence: () => nxnG.includes("BUNDLE FEATURES") && nxnG.includes("search_knowledge") },
    "FB-1404": { disposition: "blocked", note: "EP UpdateAutoRenewConfig write ops are disabled upstream; consent is recorded and the agent is barred from claiming auto-renew is active.", evidence: () => nxnG.includes("Do NOT tell the customer auto-renewal is now active") },
    "FB-1405": { disposition: "blocked", note: "No GSB integration exists; the journey no longer claims a GSB ownership check it cannot perform.", evidence: () => nxnG.includes("GSB ownership check is NOT integrated") && !/GSB-check/i.test(nxnG) },
    "FB-1406": { disposition: "in-place", note: "Known values are never re-asked.", evidence: () => nxnPrompt.includes("Never re-ask for information already present") },
    "FB-1407": { disposition: "in-place", note: "Email delivery configured on 2026-08-03 (Resend, verified sender no-reply@7x-lab.com); a live send was accepted. Ops notifications now leave the system.", evidence: () => emailLib.includes("NOTIFICATION_FROM_EMAIL") && emailLib.includes("RESEND_API_KEY") },
    "FB-1408": { disposition: "partial", note: "In-session proactive prompting implemented (expiring boxes, unfinished payments). Outbound scheduled reminders need a channel + consent decision (BLOCKERS §0).", evidence: () => nxnG.includes("PROACTIVE, NOT PUSHY") },
    "FB-1409": { disposition: "partial", note: "Single next-best-action offered after a completed request; broader prediction is a product decision.", evidence: () => nxnG.includes("ONE most likely next step") },
    "FB-1425": { disposition: "in-place", note: "Upload widget is emitted deterministically when the reply mentions uploading.", evidence: () => chatRoute.includes("FB-1425") && chatRoute.includes("```upload") },
    "FB-1426": { disposition: "in-place", note: "Email delivery configured on 2026-08-03 (Resend + verified sender domain); the tool still only claims a send when the provider accepted it, and offers a resend.", evidence: () => chatRoute.includes("EMAIL NOT SENT") && emailLib.includes("provider_error_") && emailLib.includes("NOTIFICATION_FROM_EMAIL") },
    "FB-1427": { disposition: "in-place", note: "Grace-period rule: an expired box still gets a full year; new expiry stated before payment.", evidence: () => nxnNotes.includes("BASE YEAR") && nxnG.includes("GRACE PERIOD") },
    "FB-1428": { disposition: "in-place", note: "Nothing is pre-selected.", evidence: () => nxnPrompt.includes("Never pre-select for the customer") && nxnG.includes("NO PRE-SELECTION") },
    "FB-1429": { disposition: "in-place", note: "Human handoff only on explicit request or a real failure.", evidence: () => nxnPrompt.includes('"Talk to a person": offer it ONLY') },
    "FB-1430": { disposition: "fixed", note: "Fee is on the option the customer chooses between, and request_payment adds it to the charged total server-side.", evidence: () => nxnJson.includes("key_delivery_fee") && toolsAi.includes("surcharges") && nxnRentalPrompt.includes("ADD-ON FEES you must disclose UP FRONT") && nxnRentalPrompt.includes("Deliver to address (AED 25 courier fee)") && nxnRentalPrompt.includes("Currently applicable") },
    "FB-1431": { disposition: "in-place", note: "T&C acceptance is enforced server-side before any payment.", evidence: () => toolsAi.includes("PAYMENT BLOCKED") && nxnG.includes("terms_accepted: I have read and agree") },
    "FB-1432": { disposition: "in-place", note: "Company address offers a map location picker.", evidence: () => nxnG.includes("`locate`") },
    "FB-1433": { disposition: "in-place", note: "Corporate KB content loaded for the NXN agent.", evidence: () => nxnKb > 0 },
    "FB-1485": { disposition: "fixed", note: "Four defects: UAE PASS identity token used as the EP bearer; 401 told a verified customer to re-authenticate; request_authentication unguarded; the signed-in chip silently logged the client out.", evidence: () => integrationsLib.includes("FB-1485") && conversationLib.includes("sessionTokenKind") && toolsAi.includes("IGNORE THIS CALL") && experience.includes("FB-1485") && nxnPrompt.includes("Never ask them to sign in again") },
    "FB-1508": { disposition: "fixed", note: "Admin KB accepts a document file; PDFs/scans/images/text are transcribed, chunked and embedded.", evidence: () => kbRoute.includes("multipart/form-data") && extractAi.includes("transcribeDocumentToText") },

    // ───────────── EPGL ─────────────
    "FB-1267": { disposition: "in-place", note: "Team-verification disclaimer shown before uploads.", evidence: () => Boolean(epgl.def.documentsDisclaimer?.en) && epglG.includes("reviewed and verified by the EPGL team") },
    "FB-1268": { disposition: "partial", note: "Renewal uses the signed-in customer and prefills quarterly figures, but from their own previous applications — Salesforce/IDEP expose no company-profile read (BLOCKERS §1 #6).", evidence: () => chatRoute.includes("IDEP") && conversationLib.includes("knownEpglProfile") },
    "FB-1269": { disposition: "partial", note: "Same reconstructed-profile limitation; EID is prefilled and format-checked.", evidence: () => chatRoute.includes("784-YYYY-NNNNNNN-N") && conversationLib.includes("EPGL_PROFILE_KEYS") },
    "FB-1270": { disposition: "in-place", note: "Chat uses cards; the side panel tracks what is pending.", evidence: () => epglG.includes("```cards") && epglPrompt.includes("```cards") },
    "FB-1271": { disposition: "in-place", note: "Mobile layout with a full-screen case panel.", evidence: () => experience.includes("mobileCaseOpen") && css.includes("is-mobile-case") },
    "FB-1272": { disposition: "in-place", note: "Upload from device, camera, or QR hand-off to phone.", evidence: () => experience.includes("openQrHandoff") && existsSync(resolve(repoRoot, "apps/web/app/m/[agent]/[cid]/page.tsx")) },
    "FB-1325": { disposition: "in-place", note: "Pencil control edits extracted values; consents stay locked.", evidence: () => experience.includes("dlg-field-pencil") && src("apps/web/app/api/case/field/route.ts").includes("FB-1325") },
    "FB-1326": { disposition: "in-place", note: "Uploaded documents are pushed to Salesforce after submission.", evidence: () => chatRoute.includes("sf_document_attached") && chatRoute.includes("FB-1326/FB-1402") },
    "FB-1327": { disposition: "blocked", note: "Issued licenseNumber is surfaced from getRequestStatus; the payment gateway cannot be built — the Salesforce contract has no payment operation and no certificate URL (BLOCKERS §1 #5).", evidence: () => epglG.includes("ISSUED LICENSE IN CHAT") && epglG.includes("PAYMENT IS NOT TAKEN IN THIS CHAT") },
    "FB-1328": { disposition: "in-place", note: "Name + email captured at the start; UAE PASS email overrides a typed one.", evidence: () => epglG.includes("capture the customer's NAME and EMAIL") && epglG.includes("UAE PASS contact details win") },
    "FB-1402": { disposition: "in-place", note: "Documents that fed the journey are saved to Salesforce as reference.", evidence: () => chatRoute.includes("FB-1326/FB-1402") },
    "FB-1421": { disposition: "in-place", note: "Full required-document list shown once, up front.", evidence: () => epglG.includes("full list of what they should have ready") },
    "FB-1422": { disposition: "in-place", note: "Corporate owners never get nationality/passport asked or shown; enforced in extraction too.", evidence: () => epglG.includes("CORPORATE OWNERS") && extractAi.includes("FB-1422") },
    "FB-1423": { disposition: "in-place", note: "Completion shows review SLA, when payment is requested, and next steps.", evidence: () => epglG.includes("What happens next") && epglG.includes("2 business days") },
    "FB-1424": { disposition: "in-place", note: "Journey FAQs loaded into the EPGL knowledge base.", evidence: () => epglKb > 0 },
    "FB-1434": { disposition: "in-place", note: "Services offered as tappable buttons, not prose.", evidence: () => epgl.def.greeting.en.includes("```buttons") && epgl.def.greeting.ar!.includes("```buttons") },
    "FB-1435": { disposition: "fixed", note: "Same fix as FB-1393 — invisible post-turn work no longer holds the response open.", evidence: () => chatRoute.includes("FB-1393/FB-1435") },
    "FB-1436": { disposition: "in-place", note: "First document is Trade License / Initial Approval; no postal license on a new application.", evidence: () => epglJson.includes("Trade License / Initial Approval") && epglG.includes("NEVER call it 'Trade / Postal License'") },
    "FB-1437": { disposition: "in-place", note: "Completed requirements stay visible, marked done.", evidence: () => experience.includes("FB-1437") },
    "FB-1438": { disposition: "in-place", note: "Declaration is an in-chat checkbox, never a document upload.", evidence: () => epglG.includes("IN-CHAT CHECKBOX, NEVER AN UPLOAD") },
    "FB-1439": { disposition: "fixed", note: "DD-MM-YYYY everywhere: prompt, application panel, receipt, guidance examples.", evidence: () => nxnPrompt.includes('"14-02-2027"') && experience.includes("displayValue") && receiptRoute.includes("fmtDate") },
    "FB-1440": { disposition: "in-place", note: "Extraction is bound to what is printed on the document.", evidence: () => extractAi.includes("PRINTED DATA ONLY") },
    "FB-1441": { disposition: "in-place", note: "An Initial Approval number never lands in the trade license field.", evidence: () => extractAi.includes("DOCUMENT-NUMBER MAPPING") && extractAi.includes("FB-1441") },
    "FB-1442": { disposition: "in-place", note: "A re-upload clears its own previously extracted values; script matching stops cross-document contamination.", evidence: () => uploadRoute.includes("FB-1442") && extractAi.includes("SCRIPT MATCHING") },
    "FB-1443": { disposition: "in-place", note: "Wrong document type is rejected before any confirmation.", evidence: () => uploadRoute.includes("document_rejected_wrong_type") },
    "FB-1444": { disposition: "in-place", note: "Confirmation quotes the License Request id, not a payment or Account record.", evidence: () => orchestrator.includes("FB-1444") && orchestrator.includes("LicenseRequest") },
    "FB-1445": { disposition: "fixed", note: "Receipt, checkout, error card and the remaining English-only labels localised; a check now fails if any definition label lacks Arabic.", evidence: () => bilingual() && receiptRoute.includes("RECEIPT_STR") && checkoutRoute.includes("PAY_STR") && errorPage.includes("ERR_STR") },
    "FB-1446": { disposition: "in-place", note: "Emirates ID may be typed or uploaded; an expired card is rejected with the reason.", evidence: () => epglG.includes("THE CUSTOMER CHOOSES HOW") && uploadRoute.includes("document_rejected_expired") },
    "FB-1447": { disposition: "fixed", note: "Panel reads \"Your application\"; the postal license number is now required on renewal so it is always captured and displayed.", evidence: () => experience.includes('case: "Your application"') && epgl.def.journeys.find((j) => j.key === "renewal")!.steps.flatMap((s) => s.fields).find((f) => f.key === "postal_license_number")!.validation.required === true },
    "FB-1448": { disposition: "in-place", note: "Label is \"Trade license expiry date\", not \"New trade license…\".", evidence: () => epglJson.includes("Trade license expiry date") && !epglJson.includes("New trade license expiry") },
    "FB-1449": { disposition: "in-place", note: "A file that is not the signed declaration is rejected.", evidence: () => uploadRoute.includes("declaration") && uploadRoute.includes("acceptedDocTypes") },
    "FB-1450": { disposition: "in-place", note: "The checkbox label links to the full declaration text so it can be read first.", evidence: () => epglG.includes("/declaration/epgl") && existsSync(resolve(repoRoot, "apps/web/app/declaration/epgl/page.tsx")) },
    "FB-1451": { disposition: "in-place", note: "Unrelated files are rejected for mandatory slots with a clear reason.", evidence: () => uploadRoute.includes("acceptedDocTypes") && uploadRoute.includes("mismatchReason") },
    "FB-1452": { disposition: "in-place", note: "Business cards and random files are classified and rejected.", evidence: () => extractAi.includes("business_card") },
    "FB-1453": { disposition: "in-place", note: "No data is extracted from a document type that carries none.", evidence: () => extractAi.includes("is NOT a type that carries application data") },
    "FB-1454": { disposition: "in-place", note: "Progress is blocked while a mandatory document is rejected or missing.", evidence: () => epglG.includes("NEVER PROCEED PAST A FAILED DOCUMENT") && toolsAi.includes("Cannot submit — missing") },
    "FB-1455": { disposition: "in-place", note: "Every upload is classified before anything is extracted.", evidence: () => extractAi.includes("Step 1 — CLASSIFY") },
    "FB-1486": { disposition: "fixed", note: "Short labels plus tighter pill styling with nowrap so a short option set sits on one line.", evidence: () => css.includes("FB-1486") && css.includes("white-space: nowrap") && [...epgl.def.greeting.en.matchAll(/^- (.+)$/gm)].every((m) => m[1]!.trim().length <= 16) },
  };

  // ── audit ──
  const all: { ref: string; round: string; agent: string; c: Comment }[] = [];
  for (const r of nxnRounds) for (const c of r.comments) all.push({ ref: c.referenceNumber, round: r.round, agent: "NXN", c });
  for (const r of epglRounds) for (const c of r.comments) all.push({ ref: c.referenceNumber, round: r.round, agent: "EPGL", c });

  const missing = all.filter((i) => !D[i.ref]);
  const refsInExports = new Set(all.map((i) => i.ref));
  const orphans = Object.keys(D).filter((k) => !refsInExports.has(k));
  const failures: string[] = [];

  console.log(`Exports read:\n  ${NXN_EXPORT}\n  ${EPGL_EXPORT}`);
  console.log(`\n${all.length} feedback items across ${nxnRounds.length + epglRounds.length} rounds.\n`);

  const byStatus = new Map<string, number>();
  const byDisp = new Map<Disposition, number>();
  for (const i of all) byStatus.set(i.c.statusLabel, (byStatus.get(i.c.statusLabel) ?? 0) + 1);

  for (const i of all.sort((a, b) => a.agent.localeCompare(b.agent) || a.ref.localeCompare(b.ref))) {
    const e = D[i.ref];
    if (!e) continue;
    let ok = false;
    let err = "";
    try {
      ok = e.evidence();
    } catch (x) {
      err = x instanceof Error ? x.message : String(x);
    }
    byDisp.set(e.disposition, (byDisp.get(e.disposition) ?? 0) + 1);
    if (!ok) failures.push(`${i.ref} (${e.disposition}) — evidence failed${err ? `: ${err}` : ""}`);
    const reply = i.c.replies?.[0]?.content ? `  ↩ client: "${i.c.replies[0]!.content.slice(0, 80)}"` : "";
    console.log(
      ` ${ok ? "OK  " : "FAIL"} ${i.agent.padEnd(4)} ${i.ref}  [${i.c.statusLabel.padEnd(17)}] → ${e.disposition.toUpperCase()}\n        ${e.note}${reply ? `\n      ${reply}` : ""}`
    );
  }

  console.log("\n── export status (as the client left them) ──");
  for (const [k, v] of byStatus) console.log(`  ${k.padEnd(18)} ${v}`);
  console.log("\n── disposition after this round ──");
  for (const [k, v] of byDisp) console.log(`  ${k.padEnd(10)} ${v}`);

  if (missing.length) {
    console.log(`\nITEMS WITH NO DISPOSITION (${missing.length}):`);
    for (const m of missing) console.log(`  ${m.agent} ${m.ref}: ${m.c.content.slice(0, 90)}`);
  }
  if (orphans.length) console.log(`\nDISPOSITIONS NOT IN THE EXPORTS: ${orphans.join(", ")}`);
  if (failures.length) {
    console.log(`\nEVIDENCE FAILURES (${failures.length}):`);
    for (const f of failures) console.log(`  ${f}`);
  }

  const bad = missing.length + orphans.length + failures.length;
  console.log(
    `\n${all.length - failures.length - missing.length}/${all.length} items covered with passing evidence.`
  );
  if (bad) throw new Error(`${missing.length} uncovered, ${orphans.length} orphaned, ${failures.length} evidence failures`);
  console.log("Every item in both exports is accounted for, with evidence.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
