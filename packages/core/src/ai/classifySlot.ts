/**
 * WHICH OF THIS APPLICATION'S DOCUMENTS IS THIS FILE? (6 November 2026)
 *
 * The batch upload ("Upload all at once"): the applicant drops every file they
 * have in one go and each one has to find its own slot. The extractor's fixed
 * taxonomy is not enough for that — it says "declaration" for the beneficial
 * ownership declaration, the operational standards self-declaration and the
 * fleet declaration alike, and "passport" whichever partner it belongs to.
 *
 * So the question asked here is the application's own: these are the slots
 * this application still has, with their names and what they are — which one
 * is this? Partners are told apart by the name printed on the document against
 * the partner names the case holds. A file that is none of them comes back
 * null, and is reported to the applicant as not recognised, never forced into
 * the nearest slot.
 *
 * Only the slot is decided here. The file then goes through the ordinary upload
 * path for that slot — the same extraction, type gate, expiry and identity
 * checks as a file uploaded one at a time.
 */
import { getAnthropic, extractionModel, withModelFallback } from "./anthropic";

export interface SlotCandidate {
  key: string;
  label: string;
  description?: string;
  /** Whose document this slot is, for per-person slots. */
  holder?: string;
}

export interface SlotChoice {
  key: string | null;
  /** The name printed on an identity document, when there is one. */
  holderName?: string;
  why?: string;
}

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export function slotPrompt(candidates: SlotCandidate[]): string {
  const list = candidates
    .map((c) => `  "${c.key}": ${c.label}${c.holder ? ` — belonging to ${c.holder}` : ""}${c.description ? ` (${c.description})` : ""}`)
    .join("\n");
  return (
    "You are sorting one uploaded file into a licence application. The application needs these documents (key: what it is):\n" +
    list +
    "\n\nDecide which ONE of them this file is.\n" +
    "- Judge by what the document IS — its title, issuer and content — never by its file name.\n" +
    "- A passport or Emirates ID belongs to ONE person: match the name printed on it to the person each slot belongs to. If it matches none of them, answer null.\n" +
    "- Declarations look alike. Tell them apart by their title and what they declare (who owns the company, operating standards, the vehicle fleet, …).\n" +
    "- A trade licence and an SME licence are different documents: an SME licence certifies the company's size classification and lists no activities.\n" +
    "- If the file is none of these, or you are not sure, answer null. A wrong slot is worse than none.\n" +
    'Respond with JSON only: {"key": "<one of the keys above>" | null, "holderName": "<name printed on an identity document, if any>", "why": "<a few words>"}'
  );
}

export function parseSlotChoice(text: string, candidates: SlotCandidate[]): SlotChoice {
  try {
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const key = typeof parsed.key === "string" && candidates.some((c) => c.key === parsed.key) ? parsed.key : null;
    return {
      key,
      holderName: typeof parsed.holderName === "string" && parsed.holderName.trim() ? parsed.holderName.trim() : undefined,
      why: typeof parsed.why === "string" ? parsed.why : undefined,
    };
  } catch {
    return { key: null, why: "unreadable answer" };
  }
}

export async function classifyDocumentIntoSlot(input: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  candidates: SlotCandidate[];
}): Promise<SlotChoice> {
  if (!input.candidates.length) return { key: null, why: "nothing left to place it in" };
  const ext = (input.fileName.split(".").pop() ?? "").toLowerCase();
  const isPdf = ext === "pdf" || input.contentType === "application/pdf";
  const imageType = IMAGE_TYPES[ext] ?? (input.contentType.startsWith("image/") ? input.contentType : null);
  if (!isPdf && !imageType) return { key: null, why: "not a PDF or an image" };
  const data = Buffer.from(input.bytes).toString("base64");
  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: imageType, data } };
  const client = getAnthropic();
  const res = await withModelFallback(extractionModel(), (model) =>
    client.messages.create({
      model,
      max_tokens: 200,
      messages: [{ role: "user", content: [block as unknown as never, { type: "text", text: slotPrompt(input.candidates) }] }],
    })
  );
  const text = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
  return parseSlotChoice(text, input.candidates);
}
