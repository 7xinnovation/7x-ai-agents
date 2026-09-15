import type { AgentDefinition, CaseState, FieldDef, Locale } from "@dialog/config";
import { getAnthropic, extractionModel, withModelFallback } from "./anthropic";
import { findJourney } from "../case/engine";

/**
 * Vision-based field extraction from an uploaded document (feedback: EPGL should
 * ask for documents first and extract details to auto-fill, instead of asking
 * many questions). Given a document's bytes, we ask a vision model to read it and
 * return values for the active journey's fields. Best-effort: any failure returns
 * an empty map so the upload itself never fails on extraction.
 *
 * Round-1-internal feedback hardening (FB-1440..FB-1455): the same vision call
 * now also CLASSIFIES the document into a fixed taxonomy before extraction, so
 * the upload route can reject a file that is not the requested document type
 * (e.g. a Trade License uploaded into the MOA slot, or a business card), and
 * extraction is bound to what is PRINTED on this document only — no values from
 * memory/filenames, no English text in Arabic-name fields, no nationality for a
 * corporate owner, and an Initial Approval's number never lands in the trade
 * license number field.
 *
 * Supports PDFs (Claude `document` blocks) and images (`image` blocks). Only
 * fields the document actually contains are returned — the model is told to omit
 * anything it cannot read with confidence, so we never fabricate application data.
 */

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** Fixed classification taxonomy for official-document uploads. */
export const DOC_TYPES = [
  "trade_license",
  "initial_approval",
  "postal_license",
  "moa",
  "emirates_id",
  "passport",
  "financial_statement",
  // Renewal-round feedback: a Form 9 uploaded into the trade-licence slot was
  // accepted, because the taxonomy had no name for it and the classifier had to
  // force-fit an official-looking document to the nearest type. Naming these
  // three is what lets the slot gate reject them.
  "form_9",
  "audited_financial_statement",
  "acknowledgement_letter",
  "declaration",
  "business_card",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Human labels for the taxonomy, used in customer-facing rejection reasons. */
export const DOC_TYPE_LABELS: Record<DocType, { en: string; ar: string }> = {
  trade_license: { en: "Trade License", ar: "رخصة تجارية" },
  initial_approval: { en: "Initial Approval", ar: "موافقة مبدئية" },
  postal_license: { en: "Postal License", ar: "رخصة بريدية" },
  moa: { en: "Memorandum of Association", ar: "عقد تأسيس" },
  emirates_id: { en: "Emirates ID card", ar: "بطاقة هوية إماراتية" },
  passport: { en: "Passport", ar: "جواز سفر" },
  financial_statement: { en: "Financial statement", ar: "بيان مالي" },
  form_9: { en: "Form 9", ar: "النموذج 9" },
  audited_financial_statement: { en: "Audited Financial Statements (AFS)", ar: "البيانات المالية المدققة" },
  acknowledgement_letter: { en: "Acknowledgement letter", ar: "خطاب إقرار" },
  declaration: { en: "Declaration / undertaking form", ar: "نموذج إقرار وتعهد" },
  business_card: { en: "Business card", ar: "بطاقة أعمال" },
  other: { en: "Unrecognised document", ar: "مستند غير معروف" },
};

/** Which journey fields a document may fill. Exported so the exclusions are testable. */
export function extractionFieldsFor(agent: AgentDefinition, state: CaseState, locale: Locale): { key: string; desc: string; type: string; options?: string[] }[] {
  const journey = findJourney(agent, state.journeyKey);
  if (!journey) return [];
  const out: { key: string; desc: string; type: string; options?: string[] }[] = [];
  const label = (f: FieldDef) => (typeof f.label === "string" ? f.label : f.label[locale] ?? f.label.en ?? f.key);
  for (const step of journey.steps) {
    for (const f of step.fields) {
      // Consent/boolean fields (and their server-stamped timestamps) are user
      // decisions, not document facts — skip.
      if (f.type === "boolean" || /(_consent|_accepted|_acknowledged)(_at)?$/.test(f.key)) continue;
      /**
       * A PARTNER'S RESIDENCE IS NOT PRINTED ON ANYTHING WE ARE SENT.
       *
       * EPGL asked for a non-resident option on 11 September, and it waives that
       * partner's Emirates ID — the only value in the journey that removes a
       * mandatory document. Adding the field put it in front of this extractor
       * as `partner_3_residence (one of: Citizen, Resident, Non Resident)`, and
       * a passport was enough for it: two consecutive end-to-end runs marked a
       * British partner Non Resident and submitted without her Emirates ID
       * (LR-37340 and LR-37341, 13 September).
       *
       * A guard on collect_field did not catch it, because this path does not go
       * through collect_field — extracted values are written straight to the
       * case. And no correct version of this exists: a passport shows
       * nationality, an MOA shows a shareholding, and neither states whether
       * somebody lives in the UAE. Most UAE residents hold a foreign passport.
       *
       * So it is not offered for extraction at all. It comes from the customer,
       * through the question, or it stays empty and the Emirates ID stays
       * required — which is the safe direction.
       */
      if (/_residence$/.test(f.key)) continue;
      /**
       * And how they want to pay, for the same reason: the customer chooses it,
       * no document can know it, and reading it wrong sends them down the wrong
       * payment branch.
       */
      if (f.key === "payment_method") continue;
      out.push({
        key: f.key,
        desc: label(f),
        type: f.type,
        options: f.options?.map((o) => o.value),
      });
    }
  }
  return out;
}

export interface ExtractionResult {
  values: Record<string, string>;
  /** The expiry date printed on the document itself (ISO YYYY-MM-DD), when one
   *  exists — lets the caller reject expired identity documents (e.g. an
   *  expired Emirates ID) before they enter the case. */
  docExpiryDate?: string;
  /** What the vision model classified this document as (fixed taxonomy) — lets
   *  the caller reject a file uploaded into the wrong slot before any of its
   *  data is applied. Absent when classification failed. */
  docType?: DocType;
  note?: string;
}

/** Synthetic extraction keys (never journey fields). */
const DOC_EXPIRY_KEY = "__document_expiry_date";
const DOC_TYPE_KEY = "__document_type";
const OWNER_ENTITY_KEY = "__owner_entity_type";

const ARABIC_RE = /[؀-ۿ]/;
const LATIN_RE = /[A-Za-z]/;

export async function extractFieldsFromDocument(input: {
  agent: AgentDefinition;
  state: CaseState;
  locale: Locale;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  /** The document slot being filled (key + customer-facing label), so the model
   *  knows what was REQUESTED — used for classification, never to bias reading. */
  expected?: { key: string; label: string };
}): Promise<ExtractionResult> {
  const fields = extractionFieldsFor(input.agent, input.state, input.locale);
  if (fields.length === 0) return { values: {} };

  const ext = (input.fileName.split(".").pop() ?? "").toLowerCase();
  const isPdf = ext === "pdf" || input.contentType === "application/pdf";
  const imageType = IMAGE_TYPES[ext] ?? (input.contentType.startsWith("image/") ? input.contentType : null);
  if (!isPdf && !imageType) return { values: {} }; // nothing a vision model can read

  const b64 = Buffer.from(input.bytes).toString("base64");
  const source = isPdf
    ? { type: "base64" as const, media_type: "application/pdf" as const, data: b64 }
    : { type: "base64" as const, media_type: (imageType as string), data: b64 };
  const docBlock = isPdf
    ? { type: "document" as const, source }
    : { type: "image" as const, source: source as { type: "base64"; media_type: string; data: string } };

  const fieldList = fields
    .map((f) => `  "${f.key}": ${f.desc}${f.type === "enum" && f.options ? ` (one of: ${f.options.join(", ")})` : ` (${f.type})`}`)
    .join("\n") +
    `\n  "${DOC_EXPIRY_KEY}": the expiry date printed on THIS document itself, if it has one (date)` +
    `\n  "${DOC_TYPE_KEY}": what THIS document IS — exactly one of: ${DOC_TYPES.join(", ")}` +
    `\n  "${OWNER_ENTITY_KEY}": only when the document names a primary owner/partner — "individual" if that owner is a person, "corporate" if it is a company/legal entity`;

  const instruction =
    "You are examining an uploaded document for a UAE government service application.\n" +
    (input.expected ? `The customer was ASKED to upload: "${input.expected.label}". First classify what this file actually is — do NOT assume it is what was requested.\n` : "") +
    "Step 1 — CLASSIFY: decide what this document IS from the fixed list in the field \"" + DOC_TYPE_KEY + "\" below. If it is none of those (a random photo, letter, invoice…), use \"other\". A business card is \"business_card\", never a license.\n" +
    "  Tell these apart carefully — they are commonly confused and must NEVER be classified as a trade license:\n" +
    "  • \"form_9\" — a Form 9 / Form No. 9 return or declaration of postal revenue submitted to the regulator. It reports revenue figures per period. It is NOT a license of any kind.\n" +
    "  • \"audited_financial_statement\" — audited financial statements / AFS, an auditor's report or signed balance sheet and income statement for a financial year.\n" +
    "  • \"acknowledgement_letter\" — a letter acknowledging receipt or completion (e.g. of an audit or submission), usually on letterhead and signed.\n" +
    "  • \"financial_statement\" — an unaudited statement or a plain quarterly trial balance.\n" +
    "  A trade or postal LICENSE grants the right to operate and carries a license number, issuing authority and expiry date. If the document reports figures or acknowledges a submission rather than granting a right to operate, it is NOT a license — classify it as one of the four above.\n" +
    "Step 2 — EXTRACT: return ONLY the fields whose values are VISIBLY PRINTED on this document. Extract these fields (key: description):\n" +
    fieldList +
    "\n\nRules:\n" +
    "- Return a single JSON object mapping field key to the extracted value. Omit any key you cannot find or are unsure about — never guess or fabricate.\n" +
    "- PRINTED DATA ONLY: extract only what is visibly written on THIS document. Never derive a value from the file name, a logo, prior knowledge, or another document. If a company name is not printed on the document (common on an Initial Approval), do NOT return a company name at all.\n" +
    "- THE COMPANY NAME IS EVIDENCE, NOT JUST DATA. If the document names the company it belongs to — a Memorandum of Association, a trade licence, a Form 9 and a financial statement all do — ALWAYS return it in the company-name fields, in both scripts where both are printed, EVEN IF you believe the application already has it. It is what proves the document belongs to this company, and one that comes back without a name cannot be checked at all: an out-of-date MOA naming the company under its FORMER name was accepted on 14 September because this extraction returned four passport numbers and no company name. Omit it only when the document genuinely prints none.\n" +
    "- DOCUMENT-NUMBER MAPPING: a trade license number comes ONLY from a trade license; an INITIAL APPROVAL's approval/reference number goes ONLY into an initial-approval field (e.g. initial_approval_number) if one exists — NEVER into a trade license number field. A postal license number goes only into a postal-license field.\n" +
    "- SCRIPT MATCHING: a field asking for an ARABIC name must be filled with the Arabic text printed on the document; a field asking for an English name with the Latin text. Never copy an English value into an Arabic-name field or vice versa, and never transliterate.\n" +
    "- CORPORATE OWNERS: if the primary owner/partner named on the document is a COMPANY (corporate shareholder), set " + OWNER_ENTITY_KEY + " to \"corporate\", return its name in the owner-name field, and OMIT nationality, passport and Emirates ID fields for it — those apply to people only.\n" +
    "- For dates use ISO format YYYY-MM-DD.\n" +
    "- For enum fields, return exactly one of the allowed values.\n" +
    "- Prefer the English value when a field has both English and Arabic (except Arabic-name fields, per the script rule).\n" +
    "- For owner/partner or shareholder details, use the FIRST/primary partner (highest share).\n" +
    "- Trade or postal licenses state the licensed ACTIVITY or activity code(s) and the REGION / area (or zone) of the registered address: read those into the matching activity-code and region fields when present.\n" +
    "- ACTIVITIES MAY BE NAMES, NOT CODES: many licenses list the licensed activities in words under a heading like \"License Activities\" / \"الأنشطة المرخصة\" (e.g. \"Transport of Documents\", \"Transport of Letters\", \"Transport of Parcels\") and print no numeric code at all. Record those NAMES, comma-separated, in the activity field — a field asking for a \"code\" is still satisfied by the activity names printed on the document. Only leave it empty if the document names no activities.\n" +
    "- A license often prints the company's own CONTACT NUMBER and EMAIL (under \"Contact Information\" / \"بيانات الاتصال\"). Read them into the contact phone and contact email fields when those are empty — they are the company's official contact details.\n" +
    "- The registered address on a license usually contains the area / district NAME (e.g. Al Quoz, Deira, Bur Dubai, Business Bay, Mirdif). Extract that area name into the region field even when it is part of a longer address line, and put the full address in the address/street field.\n" +
    "- Memoranda of Association and partner lists usually give each partner's EMIRATES ID number, NATIONALITY and PASSPORT number: read the primary owner's into the matching owner fields.\n" +
    "- A single phone number on the document can fill BOTH an owner-contact and a general contact-phone field if the document shows only one number for that person.\n" +
    "- If the document is an identity card (e.g. Emirates ID) and the fields describe an agent/representative, map the card's name, ID number and expiry to those agent fields only.\n" +
    "- If the document is an Emirates ID card and the fields include an owner/signatory Emirates ID field, map the card's ID number (format 784-YYYY-NNNNNNN-N) into it, and the holder's name/nationality into the matching owner fields when present.\n" +
    "- If the document is NOT a type that carries application data (business_card, other), return ONLY the " + DOC_TYPE_KEY + " classification and nothing else.\n" +
    "- Respond with the JSON object only, no prose, no markdown fences.";

  try {
    const client = getAnthropic();
    const res = await withModelFallback(extractionModel(), (model) => client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: [docBlock as unknown as never, { type: "text", text: instruction }] }],
    }));
    const text = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const validKeys = new Set(fields.map((f) => f.key));
    const values: Record<string, string> = {};
    let docExpiryDate: string | undefined;
    let docType: DocType | undefined;
    let ownerEntity: string | undefined;
    for (const [k, v] of Object.entries(parsed)) {
      if (v === null || v === undefined || v === "") continue;
      if (k === DOC_EXPIRY_KEY) {
        const d = String(v).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
        if (d) docExpiryDate = d;
        continue;
      }
      if (k === DOC_TYPE_KEY) {
        const t = String(v).toLowerCase().trim() as DocType;
        if ((DOC_TYPES as readonly string[]).includes(t)) docType = t;
        continue;
      }
      if (k === OWNER_ENTITY_KEY) {
        ownerEntity = String(v).toLowerCase().trim();
        continue;
      }
      if (!validKeys.has(k)) continue;
      values[k] = typeof v === "string" ? v : String(v);
    }

    // ── Deterministic post-filters (belt and braces over the prompt rules) ──
    // Script matching (FB-1442): an Arabic-name field must contain Arabic
    // script; an explicitly-English name field must contain Latin script.
    for (const [k, v] of Object.entries(values)) {
      if (/_ar$/.test(k) && !ARABIC_RE.test(v)) delete values[k];
      else if ((/_en$/.test(k) || k === "company_name") && !LATIN_RE.test(v) && ARABIC_RE.test(v)) delete values[k];
    }
    // Corporate owner (FB-1422): person-only attributes never apply.
    if (ownerEntity === "corporate") {
      for (const k of Object.keys(values)) {
        if (/owner_(nationality|passport|emirates_id)/.test(k)) delete values[k];
      }
    }
    // Initial Approval number mis-mapping (FB-1441): its number is not a trade
    // license number — move it to an initial-approval field when one exists.
    if (docType === "initial_approval" && values.trade_license_number) {
      if (validKeys.has("initial_approval_number") && !values.initial_approval_number) {
        values.initial_approval_number = values.trade_license_number;
      }
      delete values.trade_license_number;
    }

    return { values, docExpiryDate, docType };
  } catch (e) {
    return { values: {}, note: e instanceof Error ? e.message : "extraction_failed" };
  }
}

/** File extensions the KB importer can turn into text (FB-1508). */
export const KB_IMPORT_EXTENSIONS = ["pdf", "txt", "md", "markdown", "png", "jpg", "jpeg", "webp"] as const;

export interface TranscriptionResult {
  text?: string;
  error?: string;
}

/**
 * Transcribe an uploaded document into plain text for knowledge-base ingest
 * (FB-1508: admins need to import a document instead of pasting text).
 *
 * Plain text and markdown are decoded directly. PDFs and images go through the
 * same Claude document/image blocks the field extractor uses, so scanned pages
 * and Arabic content work without adding a PDF/OCR dependency. The model is told
 * to TRANSCRIBE ONLY — never summarise or add anything — because whatever comes
 * back becomes the grounding the agent cites to customers.
 */
export async function transcribeDocumentToText(input: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<TranscriptionResult> {
  const ext = (input.fileName.split(".").pop() ?? "").toLowerCase();
  const isPdf = ext === "pdf" || input.contentType === "application/pdf";
  const imageType = IMAGE_TYPES[ext] ?? (input.contentType.startsWith("image/") ? input.contentType : null);

  if (ext === "txt" || ext === "md" || ext === "markdown" || input.contentType.startsWith("text/")) {
    const text = Buffer.from(input.bytes).toString("utf8").trim();
    return text ? { text } : { error: "empty_file" };
  }
  if (ext === "docx" || ext === "doc") {
    return { error: "unsupported_word_document" };
  }
  if (!isPdf && !imageType) return { error: "unsupported_file_type" };

  const b64 = Buffer.from(input.bytes).toString("base64");
  const docBlock = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: b64 } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: imageType as string, data: b64 } };

  const instruction =
    "Transcribe this document into plain text for a knowledge base.\n" +
    "Rules:\n" +
    "- Output ONLY the text that is actually in the document. Never summarise, never add explanation, never invent a heading that is not there.\n" +
    "- Preserve the document's own language and script (Arabic stays Arabic, English stays English). Do not translate.\n" +
    "- Keep the reading order and the structure: headings on their own line, list items one per line, and a BLANK LINE between sections or paragraphs (each blank-line-separated block becomes one retrievable passage).\n" +
    "- Render tables as readable lines of `label: value` pairs rather than ASCII art.\n" +
    "- Skip page furniture (page numbers, repeated headers/footers, watermarks).\n" +
    "- If the document contains no readable text, reply with exactly: NO_TEXT_FOUND";

  try {
    const client = getAnthropic();
    const res = await withModelFallback(extractionModel(), (model) => client.messages.create({
      model,
      max_tokens: 8192,
      messages: [{ role: "user", content: [docBlock as unknown as never, { type: "text", text: instruction }] }],
    }));
    const text = res.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("")
      .trim();
    if (!text || /^NO_TEXT_FOUND$/im.test(text)) return { error: "no_text_found" };
    return { text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "transcription_failed" };
  }
}
