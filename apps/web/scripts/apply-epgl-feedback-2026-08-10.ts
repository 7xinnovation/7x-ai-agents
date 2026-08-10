/**
 * Applies EPGL Round-2 feedback exported 2026-08-10 (feedback-export-2026-08-10.json):
 *
 *   FB-1564  "The AI communication needs to be more human."
 *            → persona rewritten + a VOICE rule on both journeys.
 *   FB-1565  "The next steps should be clear rather than prompted by the applicant."
 *            → a NEXT STEP rule: every message names what happens now, the
 *              journey opens with its stages, and waits are explained.
 *   FB-1566  "The only editable changes should be the client's preferred contact
 *            details." → `editable: true` on the contact fields only; every other
 *            field of those journeys becomes read-only in the panel (enforced in
 *            apps/web/app/api/case/field/route.ts) plus a rule telling the agent
 *            not to overwrite document-sourced values on request alone.
 *   FB-1567  "A pin location request for the applicant's physical address on
 *            Google Maps should be included." → a new `address_geo` field on the
 *            new-license company step, and guidance to emit a ```locate block so
 *            the applicant pins the address (the reply carries a Google Maps link).
 *
 * Idempotent: the guidance block is delimited by a marker and replaced on re-run,
 * and the field/flag edits are applied by key.
 *
 * Run from apps/web:  npx tsx scripts/apply-epgl-feedback-2026-08-10.ts
 *   prod: DATABASE_URL=<Railway DATABASE_PUBLIC_URL> npx tsx scripts/apply-epgl-feedback-2026-08-10.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const MARKER = "ROUND-2 FEEDBACK RULES (2026-08-10):";

// ── FB-1564: persona ────────────────────────────────────────────────────────
// The old persona ("accurate, calm, and government-grade in tone") is what the
// agent was reading as stiff. Accuracy is kept as a hard requirement; the tone
// instruction now describes a person rather than an institution.
const PERSONA =
  "You help businesses apply for and renew courier licenses with Emirates Post Group Licensing (EPGL). " +
  "You sound like a capable colleague who does this every day: warm, direct, and easy to follow. " +
  "You are precise about facts, requirements and timelines, and you never trade accuracy for friendliness — " +
  "but you say things the way a person would say them, not the way a form would print them. " +
  "You guide applicants step by step, collect only what applies, validate as you go, always make the next step " +
  "obvious, and route to a human when needed.";

// ── FB-1564: how the agent writes ───────────────────────────────────────────
const VOICE_RULE =
  "- HOW YOU SOUND: write like a helpful person, not a government form. Use contractions (you're, we'll, that's). " +
  "One idea per sentence, and keep sentences short. Open by acknowledging what the customer just did before you ask " +
  "for the next thing (\"Got it — the trade licence came through clearly.\"). Vary how you open; never start two " +
  "messages in a row the same way. Ban the filler: no \"Kindly be informed\", \"Please be advised\", \"as per the " +
  "above\", \"Noted with thanks\", no restating the customer's own message back at them, no numbered preamble before " +
  "a single question. No emoji, and at most one exclamation mark in an entire conversation. When something goes " +
  "wrong (a rejected document, a value you cannot accept), say so plainly and immediately, in one sentence, without " +
  "apology padding — then say how to fix it. Being human does NOT mean being vague or over-promising: never soften a " +
  "requirement, invent a timeline, or reassure the customer about an approval, a fee or a date you were not given. " +
  "In Arabic, write natural Modern Standard Arabic the way a person actually speaks it — not a word-for-word " +
  "rendering of the English.";

// ── FB-1565: the customer should never have to ask "what now?" ──────────────
const NEXT_STEP_RULE =
  "- ALWAYS SAY WHAT HAPPENS NEXT: the applicant must never have to prompt you for the next step. Every message you " +
  "send ends by naming what happens now — either exactly what you need from them, or what you are doing next. When " +
  "the next move is a choice, put it in a ```buttons block instead of asking an open question. At the very start of " +
  "a journey, say in one short sentence what the stages are and roughly how long it takes, so the customer knows the " +
  "shape of it before they begin. After every upload or captured value: confirm briefly what landed, then name the " +
  "next item in the same message — never stop on a bare confirmation. When the customer is waiting on EPGL (document " +
  "review, the payment request, issuance), tell them what will happen, roughly when, and what they will receive, " +
  "rather than leaving them to ask. When something blocks progress, say what is blocked, why, and the one action " +
  "that unblocks it. Never end a message with a bare fact, a dead end, or a vague \"let me know if you need anything\". " +
  "This rule is about SAYING what comes next — it never overrides the stage order or the one-document-at-a-time rule. " +
  "Name the next step in words; emit its control only when the journey has actually reached it.";

// The opening turn kept attaching upload blocks to the preparation list while
// still asking for the customer's name — two controls at once, before the stage
// that needs them. Pre-dates the 2026-08-10 rules; called out explicitly here
// because it is the same complaint as FB-1565 (one clear next step at a time).
const ONE_ASK_RULE =
  "- ONE ASK PER MESSAGE: emit an upload block ONLY in the message where you are actually requesting that specific " +
  "document, and only when the journey has reached it. The preparation list (\"here's what you'll need ready\") is " +
  "TEXT ONLY — it never carries an upload block, because at that point you have not asked for any document yet. " +
  "While you are still asking for the customer's name and email, emit NO upload block at all: wait for their answer. " +
  "Never put an upload block in the same message as a question about something else, and never emit two upload blocks " +
  "in one message — not for the trade licence and the MOA together, not to look more helpful. One document, one " +
  "message, then stop and wait.";

// ── FB-1566: only the customer's own contact details are theirs to change ───
const EDITABLE_RULE =
  "- WHAT THE CUSTOMER MAY CHANGE: only their preferred CONTACT details (contact person, email, phone, designation, " +
  "and on a renewal the accountant's contact) can be edited by the customer — those are theirs to set, and the " +
  "pencil control in the application panel now appears on those fields only. Everything read off an official " +
  "document (company name EN/AR, trade licence number and expiry, initial approval number, emirate, region, street " +
  "address, PO Box, postal activity codes, and the owner's name, nationality, passport and Emirates ID) is the " +
  "DOCUMENT's to state. Do NOT overwrite any of those with collect_field just because the customer tells you a " +
  "different value. If the customer says one is wrong: check it against the document with them. If we simply misread " +
  "the document, correct the field to what the document actually says. If the document itself is out of date or " +
  "wrong, explain that the application has to match the licence, and ask them to upload the corrected document — the " +
  "values are re-read from it. Never silently change a document-sourced value on the customer's word alone.";

// ── FB-1567: pin the physical address ───────────────────────────────────────
const LOCATE_RULE =
  "- PIN THE PHYSICAL ADDRESS ON A MAP: the company's physical address is confirmed on a map, not only typed. To show " +
  "the map you MUST emit a fenced locate block: a line of three backticks followed by the word `locate`, then an " +
  "optional line `label: <short call to action in the session language>`, then a closing line of three backticks. " +
  "That renders a map with a draggable pin right in the chat — nothing appears unless you emit it. Emit it in either " +
  "of these cases: (a) once the address step is reached — normally right after the trade licence has pre-filled the " +
  "address, or when the licence gave no address; or (b) IMMEDIATELY, in that same reply, whenever the customer asks " +
  "to pin, share or confirm their location, whatever stage they are at — a direct request is never deferred to a " +
  "later step. NEVER mention a map, a pin or confirming the location \"later\" without emitting the block in that " +
  "same message: saying the map is coming and showing nothing is the exact failure the customer reported before. " +
  "Their reply comes back as the address, the coordinates and a Google Maps link: record the coordinates and link " +
  "with collect_field into address_geo, and record the address text into address_street only if the licence did not " +
  "already give a better one. Emit the block once per application (again only if the customer asks to move the pin). " +
  "This is a confirmation step, not a gate: if their device refuses location, or they would rather type the address, " +
  "accept the typed address and move on — never ask twice and never block the application on it.";

const BLOCK = [
  MARKER,
  VOICE_RULE,
  NEXT_STEP_RULE,
  ONE_ASK_RULE,
  EDITABLE_RULE,
  LOCATE_RULE,
].join("\n");

/** Fields the customer may correct themselves — their own contact details. */
const EDITABLE_FIELDS = new Set([
  "contact_name",
  "contact_email",
  "contact_phone",
  "contact_designation",
  "owner_contact_no",
  "accountant_name",
  "accountant_email",
  "accountant_phone",
]);

const ADDRESS_GEO = {
  key: "address_geo",
  label: {
    en: "Pinned location (map)",
    ar: "الموقع المحدد على الخريطة",
  },
  type: "text",
  validation: { required: false },
  editable: false,
};

interface Field { key: string; editable?: boolean; [k: string]: unknown }
interface Step { key: string; fields: Field[]; [k: string]: unknown }
interface Journey { key: string; guidance?: string; steps: Step[]; [k: string]: unknown }
interface Definition { persona: string; journeys: Journey[]; uploadsPerMessage?: number; [k: string]: unknown }

/**
 * Replace an existing marked block (re-run) or append a fresh one.
 *
 * Only OUR block is removed, never the tail: other scripts append their own
 * marker-guarded guidance to these journeys, and truncating at our marker would
 * silently delete anything that landed after it. Our block is the marker line
 * plus the `- ` bullets under it, so it ends at the first following line that is
 * neither blank nor a bullet.
 */
function withBlock(guidance: string): string {
  const idx = guidance.indexOf(MARKER);
  if (idx === -1) return `${guidance.trimEnd()}\n\n${BLOCK}`;

  const after = guidance.slice(idx + MARKER.length).split("\n");
  let end = 0; // lines of ours to drop, past the marker line itself
  for (let i = 1; i < after.length; i++) {
    const line = after[i]!;
    if (line.trim() === "" || line.startsWith("- ")) { end = i; continue; }
    break;
  }
  const base = guidance.slice(0, idx).trimEnd();
  const tail = after.slice(end + 1).join("\n").trim();
  return [`${base}\n\n${BLOCK}`, tail].filter(Boolean).join("\n\n");
}

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as Definition;

  const changes: string[] = [];

  // FB-1564 — persona.
  if (def.persona !== PERSONA) {
    def.persona = PERSONA;
    changes.push("FB-1564: persona rewritten for a human tone");
  }

  // FB-1565 — one upload control per message, enforced at render rather than
  // left to the prompt (the opening turn ignored the prose rule consistently).
  if (def.uploadsPerMessage !== 1) {
    def.uploadsPerMessage = 1;
    changes.push("FB-1565: uploadsPerMessage = 1");
  }

  for (const journey of def.journeys) {
    if (!["new_license", "renewal"].includes(journey.key)) continue;

    // FB-1564 / 1565 / 1566 / 1567 — guidance block.
    const next = withBlock(journey.guidance ?? "");
    if (next !== journey.guidance) {
      journey.guidance = next;
      changes.push(`FB-1564/1565/1566/1567: guidance rules on "${journey.key}"`);
    }

    // FB-1566 — mark every field's editability explicitly. Declaring the flag
    // anywhere on a journey switches the panel and the edit API to the allowlist,
    // so every field must carry it or it would silently become read-only.
    for (const step of journey.steps) {
      for (const f of step.fields) {
        const want = EDITABLE_FIELDS.has(f.key);
        if (f.editable !== want) {
          f.editable = want;
          changes.push(`FB-1566: ${journey.key}.${f.key} editable=${want}`);
        }
      }
    }

    // FB-1567 — somewhere to keep the pinned location.
    if (journey.key === "new_license") {
      const step = journey.steps.find((s) => s.key === "company_details");
      if (!step) throw new Error("new_license.company_details step missing");
      if (!step.fields.some((f) => f.key === ADDRESS_GEO.key)) {
        const at = step.fields.findIndex((f) => f.key === "po_box");
        step.fields.splice(at === -1 ? step.fields.length : at + 1, 0, ADDRESS_GEO as unknown as Field);
        changes.push("FB-1567: address_geo field added to new_license.company_details");
      }
    }
  }

  if (!changes.length) {
    console.log("No changes — already applied.");
    return;
  }

  await db
    .update(agents)
    .set({ definition: def as never, updatedAt: new Date() })
    .where(eq(agents.id, row.id));

  console.log(`Updated ${SLUG} (${changes.length} changes):`);
  for (const c of changes) console.log(`  - ${c}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
