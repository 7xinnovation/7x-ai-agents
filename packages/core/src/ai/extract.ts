import type { AgentDefinition, CaseState, FieldDef, Locale } from "@dialog/config";
import { getAnthropic, fastModel } from "./anthropic";
import { findJourney } from "../case/engine";

/**
 * Vision-based field extraction from an uploaded document (feedback: EPGL should
 * ask for documents first and extract details to auto-fill, instead of asking
 * many questions). Given a document's bytes, we ask a vision model to read it and
 * return values for the active journey's fields. Best-effort: any failure returns
 * an empty map so the upload itself never fails on extraction.
 *
 * Supports PDFs (Claude `document` blocks) and images (`image` blocks). Only
 * fields the document actually contains are returned — the model is told to omit
 * anything it cannot read with confidence, so we never fabricate application data.
 */

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

function fieldsForExtraction(agent: AgentDefinition, state: CaseState, locale: Locale): { key: string; desc: string; type: string; options?: string[] }[] {
  const journey = findJourney(agent, state.journeyKey);
  if (!journey) return [];
  const out: { key: string; desc: string; type: string; options?: string[] }[] = [];
  const label = (f: FieldDef) => (typeof f.label === "string" ? f.label : f.label[locale] ?? f.label.en ?? f.key);
  for (const step of journey.steps) {
    for (const f of step.fields) {
      // Consent/boolean fields are user decisions, not document facts — skip.
      if (f.type === "boolean" || f.key.endsWith("_consent")) continue;
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
  note?: string;
}

export async function extractFieldsFromDocument(input: {
  agent: AgentDefinition;
  state: CaseState;
  locale: Locale;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<ExtractionResult> {
  const fields = fieldsForExtraction(input.agent, input.state, input.locale);
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
    .join("\n");

  const instruction =
    "You are extracting structured data from an official UAE document (an Emirates ID card, a trade/postal license, a Memorandum of Association, or a similar record) to pre-fill a service application.\n" +
    "Read the attached document and return ONLY the fields you can read with confidence. Extract these fields (key: description):\n" +
    fieldList +
    "\n\nRules:\n" +
    "- Return a single JSON object mapping field key to the extracted value. Omit any key you cannot find or are unsure about — never guess or fabricate.\n" +
    "- For dates use ISO format YYYY-MM-DD.\n" +
    "- For enum fields, return exactly one of the allowed values.\n" +
    "- Prefer the English value when a field has both English and Arabic.\n" +
    "- For owner/partner or shareholder details, use the FIRST/primary partner (highest share).\n" +
    "- If the document is an identity card (e.g. Emirates ID) and the fields describe an agent/representative, map the card's name, ID number and expiry to those agent fields only.\n" +
    "- Respond with the JSON object only, no prose, no markdown fences.";

  try {
    const client = getAnthropic();
    const res = await client.messages.create({
      model: fastModel(),
      max_tokens: 1024,
      messages: [{ role: "user", content: [docBlock as unknown as never, { type: "text", text: instruction }] }],
    });
    const text = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const validKeys = new Set(fields.map((f) => f.key));
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!validKeys.has(k)) continue;
      if (v === null || v === undefined || v === "") continue;
      values[k] = typeof v === "string" ? v : String(v);
    }
    return { values };
  } catch (e) {
    return { values: {}, note: e instanceof Error ? e.message : "extraction_failed" };
  }
}
