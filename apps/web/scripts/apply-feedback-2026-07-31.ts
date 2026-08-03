/**
 * Apply the 2026-07-31 feedback exports (NXN + EPGL) to the agent definitions.
 *
 * Only the items that live in DATA are here; the ones that live in code are in
 * the repo (UAE PASS session handling, DD-MM-YYYY dates, receipt/checkout/error
 * localisation, one-line buttons, asterisk PII masking, journey surcharges, KB
 * document import). Idempotent and marker-guarded: safe to re-run.
 *
 * NXN
 *  FB-1430 (re-opened) key-delivery fee is ON the option itself and is charged:
 *          the option labels carry it and the journey declares a `surcharges`
 *          entry, so request_payment adds it to the total deterministically.
 *  FB-1445 Arabic parity: every option label / intent description is bilingual
 *          (manage_po_box actions and the manage_pobox intent were English-only,
 *          so an Arabic session saw English UI text).
 *  FB-1405 GSB link is NOT integrated — the corporate journey no longer claims a
 *          GSB ownership check it cannot perform.
 *  FB-1404 save-card / auto-renewal cannot be activated end-to-end (the EP
 *          UpdateAutoRenewConfig write ops are disabled, see BLOCKERS): consent
 *          is recorded and passed on, and the agent must not claim it is active.
 *  FB-1403 bundle FEATURES come only from the knowledge base; the live tool is
 *          authoritative for names and prices only. Never invent features.
 *  FB-1323 guest renewal confirms the box holder with a MASKED name.
 *  FB-1408/1409 proactive reminders + predicted next best action.
 *  FB-1439 date examples in guidance follow the DD-MM-YYYY rule.
 *
 * EPGL
 *  FB-1486 greeting service buttons are short enough to sit on one line.
 *  FB-1447 the postal license number is REQUIRED on a renewal, so it is always
 *          captured and displayed in the application panel.
 *  FB-1327 the issued license number is surfaced in chat as soon as Salesforce
 *          has one (the payment gateway itself is not in the contract — the
 *          agent must not imply it can take payment in chat).
 *  FB-1439 date examples in guidance follow the DD-MM-YYYY rule.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

/** Courier fee for PO Box key delivery (FB-1430). Business constant — confirm
 *  against the official Emirates Post tariff before production. */
const KEY_DELIVERY_FEE = 25;

const MARKER = "FEEDBACK RULES (2026-07-31)";

/* eslint-disable @typescript-eslint/no-explicit-any */

const warnings: string[] = [];
const changes: string[] = [];

/** Replace text once, idempotently; warn if the anchor is gone. */
function replaceOnce(where: string, text: string, find: string, repl: string): string {
  if (text.includes(repl)) return text;
  if (!text.includes(find)) {
    warnings.push(`  ! ${where}: anchor not found — "${find.slice(0, 70)}…"`);
    return text;
  }
  changes.push(`  · ${where}: replaced "${find.slice(0, 50)}…"`);
  return text.replace(find, repl);
}

/** Append a marker-guarded block to a journey's guidance. */
function appendBlock(journey: any, lines: string[]) {
  const g = String(journey.guidance ?? "");
  if (g.includes(MARKER)) return;
  journey.guidance = `${g}\n\n${lines.join("\n")}`;
  changes.push(`  · ${journey.key}: appended ${MARKER} block`);
}

// ───────────────────────────── NXN ─────────────────────────────

const NXN_COMMON = [
  `${MARKER}:`,
  "- ADD-ON FEES ARE NEVER A SURPRISE: any optional extra with a fee (for example key delivery by courier) must show its fee ON the option the moment you present the choice, appear as its own line in the pre-payment summary, and be part of the total you quote. The payment total returned by request_payment already includes every applicable add-on — quote that figure, never the base price alone.",
  "- BUNDLE FEATURES: the live Emirates Post tools are authoritative for bundle NAMES and PRICES only. What a bundle INCLUDES (its features, limits, mail volumes, extras) must come from the approved knowledge base via search_knowledge. If the knowledge base does not describe a feature, say you will confirm it rather than describing it from assumption, and never restate a feature list you were not given.",
  "- AUTO-RENEWAL AND SAVED CARDS: record the customer's consent, and say plainly that the request has been submitted with their application and will be applied to the box. Do NOT tell the customer auto-renewal is now active, or that their card is stored, unless a tool call confirmed it — the backend activation is not available in this environment.",
  "- PROACTIVE, NOT PUSHY: when you can see something that needs the customer's attention (a box expiring soon or already lapsed, a payment left unfinished, an agent whose Emirates ID has expired), raise it yourself in one short line with the concrete next step, before they ask. When a request finishes, offer the ONE most likely next step for that customer (for example: renew the other box that is due, add an authorised agent, arrange key delivery) as a single ```buttons choice. One suggestion, never a menu of upsells, and never repeat a suggestion they declined.",
];

const NXN_RENEWAL_EXTRA =
  "- CONFIRM THE HOLDER, MASKED: on a guest renewal the box holder's name comes back masked (for example M*********** A**** *****B). Use it as a soft confirmation — \"this box is registered to M*********** A**** *****B, is that you?\" — and never ask the guest to reveal or complete it, and never state the full name even if you can infer it.";

async function applyNxn(dryRun: boolean) {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog")).limit(1);
  if (!agent) throw new Error("nxn-dialog not found");
  const def = agent.definition as any;
  const J = (key: string) => def.journeys.find((j: any) => j.key === key);

  // ── FB-1445: Arabic labels for the manage_po_box actions + its intent ──
  const MANAGE_AR: Record<string, string> = {
    ADD_AGENT: "إضافة وكيل مفوّض",
    REMOVE_AGENT: "إزالة وكيل مفوّض",
    KEY_DELIVERY: "توصيل المفتاح",
    AUTO_RENEWAL: "التجديد التلقائي",
    LINK_TRADE_LICENSE: "ربط الرخصة التجارية",
    LINK_PO_BOX: "ربط صندوق بريد قائم",
  };
  const manageField = J("manage_po_box")?.steps
    ?.flatMap((s: any) => s.fields)
    ?.find((f: any) => f.key === "management_action");
  for (const opt of manageField?.options ?? []) {
    if (!opt.label.ar && MANAGE_AR[opt.value]) {
      opt.label.ar = MANAGE_AR[opt.value];
      changes.push(`  · manage_po_box: Arabic label for ${opt.value}`);
    }
  }
  const manageIntent = def.intents.find((i: any) => i.key === "manage_pobox");
  if (manageIntent && !manageIntent.description.ar) {
    manageIntent.description.ar =
      "إدارة صندوق بريد قائم: وكيل مفوّض، توصيل المفتاح، التجديد التلقائي، ربط الرخصة التجارية";
    changes.push("  · intent manage_pobox: Arabic description");
  }

  // ── FB-1430: the fee rides on the option AND on the journey as a surcharge ──
  const KEY_DELIVERY_LABELS: Record<string, { en: string; ar: string }> = {
    branch_pickup: { en: "Collect from branch (free)", ar: "الاستلام من الفرع (بدون رسوم)" },
    deliver: {
      en: `Deliver to address (AED ${KEY_DELIVERY_FEE} courier fee)`,
      ar: `التوصيل إلى عنوان (رسوم بريد سريع ${KEY_DELIVERY_FEE} درهم)`,
    },
  };
  for (const jk of ["personal_po_box_rental", "corporate_po_box_rental"]) {
    const j = J(jk);
    if (!j) { warnings.push(`  ! journey ${jk} not found`); continue; }
    const field = j.steps.flatMap((s: any) => s.fields).find((f: any) => f.key === "key_delivery");
    if (!field) { warnings.push(`  ! ${jk}: key_delivery field not found`); continue; }
    for (const opt of field.options ?? []) {
      const l = KEY_DELIVERY_LABELS[opt.value];
      if (l && opt.label.en !== l.en) { opt.label = { ...opt.label, ...l }; changes.push(`  · ${jk}: fee on key_delivery option "${opt.value}"`); }
    }
    j.submission = j.submission ?? {};
    const existing: any[] = j.submission.surcharges ?? [];
    if (!existing.some((s) => s.key === "key_delivery_fee")) {
      j.submission.surcharges = [
        ...existing,
        {
          key: "key_delivery_fee",
          label: { en: "Key delivery (courier)", ar: "توصيل المفتاح (بريد سريع)" },
          amount: KEY_DELIVERY_FEE,
          when: "key_delivery == 'deliver'",
        },
      ];
      changes.push(`  · ${jk}: declared key_delivery_fee surcharge (${KEY_DELIVERY_FEE})`);
    }
  }

  // ── FB-1405: no GSB integration — stop implying an ownership check happened ──
  {
    const j = J("corporate_po_box_rental");
    let g = String(j?.guidance ?? "");
    g = replaceOnce(
      "corporate_po_box_rental",
      g,
      "Stage 2 Trade License verification (three tiers): Tier 1 — ask the issuing entity, then GSB-check whether the customer's EID matches an owner ID under that entity; one company → use it, multiple → let the customer pick. Tier 2 — if none found, ask for the trade license number and re-check the EID against the owner ID on that license. Tier 3 — if still no match or not found,",
      "Stage 2 Trade License verification: the GSB ownership check is NOT integrated in this environment, so you CANNOT verify that the customer's Emirates ID matches an owner on the trade license — never say or imply that you checked, matched, or verified ownership against a government source. Ask the issuing entity and, where the entity-lookup tools respond, use them ONLY to help the customer identify their company (one company → confirm it with them, several → let them pick). Ownership itself is confirmed by the documents: ask the customer to upload the trade license copy by emitting an upload block in that same reply",
    );
    g = replaceOnce(
      "corporate_po_box_rental",
      g,
      "and route into the existing form-based manual validation (Salesforce case, flagged pending validation). The uploaded license is saved with the application and attached to the PO Box record on submission. The GSB EID-to-owner match IS the ownership check on Tiers 1 and 2.",
      "and route into the existing form-based manual validation (Salesforce case, flagged pending validation). The uploaded license is saved with the application and attached to the PO Box record on submission. Because ownership is validated by the team from the uploaded document, tell the customer at completion that their documents are being validated — never that the box is already rented.",
    );
    g = replaceOnce(
      "corporate_po_box_rental",
      g,
      "Stage 2A: after a Tier 1/Tier 2 match, show the company's existing corporate PO Boxes before creating a new one, to avoid duplicates.",
      "Stage 2A: once the company is identified, show its existing corporate PO Boxes before creating a new one, to avoid duplicates.",
    );
    if (j) j.guidance = g;
  }

  // ── FB-1439: date examples in guidance follow DD-MM-YYYY ──
  for (const jk of ["personal_po_box_renewal", "corporate_po_box_renewal"]) {
    const j = J(jk);
    if (!j) continue;
    j.guidance = String(j.guidance ?? "").replace(/31 Dec 2027/g, "31-12-2027");
    if (j.submission?.apiFlow?.notes) {
      j.submission.apiFlow.notes = String(j.submission.apiFlow.notes).replace(/31 Dec 2027/g, "31-12-2027");
    }
  }

  // ── Common + renewal-specific blocks ──
  for (const jk of [
    "personal_po_box_rental",
    "corporate_po_box_rental",
    "personal_po_box_renewal",
    "corporate_po_box_renewal",
  ]) {
    const j = J(jk);
    if (!j) continue;
    const extra = jk.endsWith("_renewal") ? [...NXN_COMMON, NXN_RENEWAL_EXTRA] : NXN_COMMON;
    appendBlock(j, extra);
  }
  // manage_po_box has no guidance of its own; give it the common rules so the
  // auto-renewal action there is described as honestly as in the paid journeys.
  {
    const j = J("manage_po_box");
    if (j && !j.guidance) {
      j.guidance = NXN_COMMON.join("\n");
      changes.push("  · manage_po_box: added guidance with the 2026-07-31 rules");
    } else if (j) {
      appendBlock(j, NXN_COMMON);
    }
  }

  if (!dryRun) {
    await db.update(agents).set({ definition: def, updatedAt: new Date() }).where(eq(agents.id, agent.id));
  }
  return def;
}

// ───────────────────────────── EPGL ─────────────────────────────

const EPGL_BLOCK = [
  `${MARKER}:`,
  "- ISSUED LICENSE IN CHAT: when the customer asks about their application, call epglsalesforce__getRequestStatus with their license request id. The response carries a licenseNumber that stays null until the license is issued. As soon as it has a value, present it in the chat as their POSTAL ACTIVITY LICENSE number together with the current status. While it is still null, say the license has not been issued yet and give the current review status instead — never invent a license number or a certificate link.",
  "- PAYMENT IS NOT TAKEN IN THIS CHAT: EPGL issues the payment request after the documents are reviewed, and it is paid through EPGL's own channel. Explain it that way. Do NOT offer to take payment here, do not produce a payment link, and do not quote a fee you were not given by a tool or the knowledge base.",
  "- PROACTIVE NEXT STEP: after submission, offer the single most useful follow-up as a ```buttons choice (for example checking the application status), rather than a list of options.",
];

async function applyEpgl(dryRun: boolean) {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog")).limit(1);
  if (!agent) throw new Error("epgl-dialog not found");
  const def = agent.definition as any;
  const J = (key: string) => def.journeys.find((j: any) => j.key === key);

  // ── FB-1486: short service buttons so the set fits one line ──
  const GREETING = {
    en: "Hello, I'm EPGL Dialog. Here's what I can help you with:\n\n```buttons\n- New license\n- Renew license\n- Ask a question\n```",
    ar: "مرحباً، أنا EPGL Dialog. إليك ما يمكنني مساعدتك به:\n\n```buttons\n- رخصة جديدة\n- تجديد رخصة\n- طرح سؤال\n```",
  };
  if (def.greeting?.en !== GREETING.en) {
    def.greeting = GREETING;
    changes.push("  · epgl greeting: short one-line service buttons");
  }

  // ── FB-1447: a renewal always captures + displays the postal license number ──
  {
    const field = J("renewal")
      ?.steps?.flatMap((s: any) => s.fields)
      ?.find((f: any) => f.key === "postal_license_number");
    if (!field) warnings.push("  ! epgl renewal: postal_license_number field not found");
    else if (!field.validation?.required) {
      field.validation = { ...(field.validation ?? {}), required: true };
      changes.push("  · epgl renewal: postal_license_number is now required");
    }
  }

  // ── FB-1439: the guidance's own date examples ──
  for (const j of def.journeys) {
    if (!j.guidance) continue;
    j.guidance = String(j.guidance).replace(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/g, (_m: string, d: string, mon: string, y: string) => {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const mm = String(months.indexOf(mon) + 1).padStart(2, "0");
      return `${d.padStart(2, "0")}-${mm}-${y}`;
    });
  }

  for (const jk of ["new_license", "renewal"]) {
    const j = J(jk);
    if (!j) { warnings.push(`  ! epgl journey ${jk} not found`); continue; }
    appendBlock(j, EPGL_BLOCK);
  }

  if (!dryRun) {
    await db.update(agents).set({ definition: def, updatedAt: new Date() }).where(eq(agents.id, agent.id));
  }
  return def;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("DRY RUN — reporting the changes without writing\n");
  console.log("NXN…");
  await applyNxn(dryRun);
  console.log("EPGL…");
  await applyEpgl(dryRun);

  console.log("\nChanges:");
  for (const c of changes) console.log(c);
  if (warnings.length) {
    console.log("\nWarnings:");
    for (const w of warnings) console.log(w);
  }
  console.log(`\n${changes.length} change(s), ${warnings.length} warning(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
