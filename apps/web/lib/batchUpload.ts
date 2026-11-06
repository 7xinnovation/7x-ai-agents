/**
 * EPGL 2.0: "Upload all at once" or "One at a time" (6 November 2026).
 *
 * The feedback item: "Allow user to dump all documents in the agent and it
 * shall process all of them and fill the fields required accordingly and ask
 * only for pending stuff." Asked for more than once before it was built.
 *
 * The order is fixed, and none of it is left to the model's judgement:
 *   1. the licence is chosen first — every document depends on it;
 *   2. the applicant is offered the two ways, as two buttons;
 *   3. "Upload all at once" shows the list of what this application needs and
 *      ONE control that takes many files. Each file is placed in its slot by
 *      @dialog/core classifyDocumentIntoSlot, then read exactly as a single
 *      upload would be (app/api/upload, key BATCH_KEY);
 *   4. when the batch is in, ONE reply says what was found, what was not
 *      recognised, and what is still missing — and asks only for that.
 * "One at a time" is the flow as it was.
 */
import { tr, evalCondition, type AgentDefinition, type CaseState } from "@dialog/config";
import { recomputeReadiness, type SlotCandidate } from "@dialog/core";

/** The key a batch upload is posted under; the upload route resolves the real slot. */
export const BATCH_KEY = "__batch__";
/** Where the chosen way is kept on the case. */
export const UPLOAD_MODE_KEY = "upload_mode";
/** What the batch did with each file, until the next reply has reported it. */
export const BATCH_LOG_KEY = "__batch_log";

export const MODE_LABELS = {
  batch: { en: "Upload all at once", ar: "رفع جميع المستندات دفعة واحدة" },
  manual: { en: "One at a time", ar: "مستند تلو الآخر" },
} as const;

export type UploadMode = keyof typeof MODE_LABELS;

export interface BatchLog {
  placed: { file: string; key: string }[];
  unplaced: { file: string; why?: string }[];
}

/** Only EPGL 2.0's new licence: the one journey whose product decides its documents. */
export function offersBatch(def: AgentDefinition, journeyKey: string | null | undefined): boolean {
  if (def.tenantSlug !== "epgl" || journeyKey === "renewal") return false;
  const j = def.journeys.find((x) => x.key === "new_license");
  return !!j?.steps.some((s) => s.fields.some((f) => f.key === "product_code"));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z؀-ۿ]+/g, " ").trim();

/** The customer's tap (or their own words for it), or null. */
export function uploadModeFrom(message: string | undefined): UploadMode | null {
  const m = norm(message ?? "");
  if (!m) return null;
  for (const mode of ["batch", "manual"] as const) {
    const l = MODE_LABELS[mode];
    if (m === norm(l.en) || m === norm(l.ar)) return mode;
  }
  if (/\b(all at once|all together|all of them at once|bulk|batch|everything at once)\b/.test(m)) return "batch";
  if (/\b(one at a time|one by one|step by step|individually)\b/.test(m)) return "manual";
  return null;
}

const partnerName = (data: Record<string, unknown>, n: string): string | undefined => {
  const v = data[`partner_${n}_name`] ?? (data.__partner_names as Record<string, unknown> | undefined)?.[n];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/**
 * The slots a batch file may be placed in: this application's documents, as
 * its conditions stand. A slot another one satisfies (the CEP30 "Trade Licence
 * / Initial Name Approval", which IS the trade licence) is not offered — it is
 * filled from that one.
 */
export function batchCandidates(def: AgentDefinition, state: CaseState, locale: "en" | "ar"): SlotCandidate[] {
  const j = def.journeys.find((x) => x.key === (state.journeyKey || "new_license"));
  if (!j) return [];
  const data = state.data as Record<string, unknown>;
  const namesKnown = !!partnerName(data, "1");
  const out: SlotCandidate[] = [];
  for (const s of j.steps)
    for (const d of s.documents) {
      if (d.satisfiedBy?.length) continue;
      const p = PARTNER_ID.exec(d.key);
      /**
       * A PARTNER'S IDENTITY DOCUMENT BEFORE THE PARTNERS ARE KNOWN.
       *
       * Who the partners are comes off the trade licence and the MOA — which
       * may be in this very batch, and may not have been read yet. Their slots'
       * conditions (`partner_count >= 2`) are then false, and a passport would
       * be "not recognised" for want of a licence read a second later. So until
       * the names are known it is offered as ONE generic slot per kind, and the
       * partner it belongs to is settled by assignPartnerSlot.
       */
      if (p && !namesKnown) {
        if (p[1] !== "1") continue;
        out.push({ key: d.key, label: p[2] === "passport" ? "A partner's passport (any partner)" : "A partner's Emirates ID (any partner)" });
        continue;
      }
      if (d.condition && !evalCondition(d.condition, data)) continue;
      out.push({
        key: d.key,
        label: tr(d.label, locale),
        description: d.description ? tr(d.description, locale) : undefined,
        holder: p ? partnerName(data, p[1]!) : undefined,
      });
    }
  return out;
}

const PARTNER_ID = /^partner_(\d+)_(passport|emirates_id)$/;
const sameName = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
  return !!a && !!b && n(a) === n(b);
};

/**
 * Which partner's slot an identity document goes in. Run INSIDE the case's row
 * lock (mutateCase), with the slots other files of the batch have already
 * reserved, so two passports read at once cannot both take partner 1.
 *
 * By the name printed on it when that is a partner we know; otherwise the
 * first partner slot of that kind nobody holds yet.
 */
export function assignPartnerSlot(
  chosen: string,
  holderName: string | undefined,
  data: Record<string, unknown>,
  documents: { key: string; status: string }[],
  reserved: string[]
): string {
  const m = PARTNER_ID.exec(chosen);
  if (!m) return chosen;
  const kind = m[2]!;
  if (holderName) {
    for (let i = 1; i <= 8; i++) {
      const name = partnerName(data, String(i));
      if (name && sameName(name, holderName)) return `partner_${i}_${kind}`;
    }
  }
  const held = new Set([
    ...documents.filter((d) => d.status === "uploaded" || d.status === "accepted").map((d) => d.key),
    ...reserved,
  ]);
  // A named partner the document does not match is not a free slot for it.
  for (let i = 1; i <= 8; i++) {
    const key = `partner_${i}_${kind}`;
    if (held.has(key)) continue;
    const name = partnerName(data, String(i));
    if (name && holderName) continue;
    return key;
  }
  return chosen;
}

/** The documents readiness still waits on, by their customer-facing names. */
export function missingDocuments(def: AgentDefinition, state: CaseState, locale: "en" | "ar"): { key: string; label: string }[] {
  const labels = new Map<string, string>();
  for (const j of def.journeys) for (const s of j.steps) for (const d of s.documents) if (!labels.has(d.key)) labels.set(d.key, tr(d.label, locale));
  return recomputeReadiness(def, state)
    .readiness.missing.filter((m) => m.kind === "document")
    .map((m) => ({ key: m.key, label: labels.get(m.key) ?? m.key }));
}

const BATCH_BLOCK = "```upload\nkey: batch\n```";

/** Before the licence is chosen: that, and nothing else. */
export function productFirstDirective(): string {
  return (
    "\nTHIS TURN, IF THIS IS A NEW LICENCE APPLICATION: the licence comes FIRST, before any document, any upload, any company lookup and any " +
    "trade-licence question. Ask which licence or permit they are applying for and show the options as ONE ```cards block (one card per " +
    "product, `key:` the product code). The system replaces that block with the full, fixed list, so do not shorten, group or reword it, and " +
    "do NOT add an ```upload block to this reply. Looking up their company comes after the licence is chosen. If they have just said the " +
    "company on file is not theirs, do NOT ask for their trade licence now: say it goes in with their other documents once the licence is " +
    "chosen, and show the menu. (An upload block before the licence is chosen is replaced by the menu anyway.)"
  );
}

/** Licence chosen, no way chosen yet: offer the two. */
export function modeChoiceDirective(locale: "en" | "ar"): string {
  const b = MODE_LABELS.batch[locale];
  const m = MODE_LABELS.manual[locale];
  return (
    "\nTHIS TURN: the licence is chosen. Before asking for ANY document, ask how they would like to provide their documents, in one or two " +
    `sentences, and end with exactly these two buttons:\n\`\`\`buttons\n- ${b}\n- ${m}\n\`\`\`\n` +
    `"${b}" means they select every file they have in one go and you sort them; "${m}" means you ask for each document in turn. ` +
    "Do not ask for a document or show an ```upload block in this reply."
  );
}

/** They chose the batch: the list, and one control. */
export function batchStartDirective(missing: { label: string }[], locale: "en" | "ar"): string {
  return (
    "\nTHIS TURN: they chose to upload all their documents at once. List the documents this application needs as a short bulleted list — " +
    `exactly these, in this order: ${missing.map((d) => d.label).join("; ") || "(none outstanding)"}. Tell them to select all of them together ` +
    `(PDF or photos), and that you will sort each file into place and tell them if anything is missing. End with exactly this block and no other upload block:\n${BATCH_BLOCK}\n` +
    `Reply in ${locale === "ar" ? "Arabic" : "English"}.`
  );
}

/** The batch is in: one report, then only what is pending. */
export function batchReportDirective(log: BatchLog, missing: { label: string }[], labelOf: (k: string) => string): string {
  const found = log.placed.map((p) => `${labelOf(p.key)} (${p.file})`);
  const unknown = log.unplaced.map((u) => u.file);
  return (
    "\nTHE BATCH UPLOAD HAS FINISHED. Report it in ONE reply, briefly:\n" +
    `- Found and filed: ${found.join("; ") || "none"}.\n` +
    `- Not recognised as any document this application needs: ${unknown.join("; ") || "none"}.\n` +
    `- Still missing: ${missing.map((m) => m.label).join("; ") || "nothing — every document is in"}.\n` +
    "Say which were found (a short list), name any file you could not place so they can check it, and list what is still missing. " +
    (missing.length
      ? `Then ask for the missing ones with exactly one block:\n${BATCH_BLOCK}\n(they can select several files again). `
      : "Do not ask for any document. ") +
    "After that, carry on with whatever the documents did NOT answer — ask only for that, never for something already read off a document. " +
    "A document a check refused is reported by the system on its own card; mention it in one line if one was refused."
  );
}
