import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Accurate speech-to-text for in-chat voice mode. The browser records each
 * utterance and POSTs the audio here; we forward it to Azure OpenAI's
 * gpt-4o-transcribe deployment (/audio/transcriptions) with a PO-Box domain
 * prompt and return the text. The real key stays server-side. If the transcribe
 * deployment isn't configured/available, we return 501/502 and the client falls
 * back to its on-device recognition.
 *
 * Requires a `gpt-4o-transcribe` (or whisper) deployment on the resource; set
 * AZURE_TRANSCRIBE_DEPLOYMENT if it's named differently.
 */
const DEPLOYMENT = process.env.AZURE_TRANSCRIBE_DEPLOYMENT || "gpt-4o-transcribe";
const API_VERSION = process.env.AZURE_TRANSCRIBE_API_VERSION || "2025-03-01-preview";
const DOMAIN_PROMPT =
  "Emirates Post PO Box services in the UAE. Likely phrases: rent a new PO Box, renew my PO Box, " +
  "track a shipment, MyBox, MyHome, MyHome Instant, Basic, Premium, Emirate, Dubai, Abu Dhabi, Sharjah, " +
  "Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah, branch, box number, trade license, authorised agent, auto-renewal, Emirates ID.";

export async function POST(req: NextRequest) {
  const endpoint = process.env.AZURE_REALTIME_ENDPOINT; // same AI Foundry resource
  const key = process.env.AZURE_REALTIME_KEY;
  if (!endpoint || !key) return NextResponse.json({ error: "not_configured" }, { status: 501 });

  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return NextResponse.json({ error: "empty_audio" }, { status: 400 });
  const contentType = req.headers.get("content-type") || "audio/webm";
  const ext = contentType.includes("wav") ? "wav" : contentType.includes("ogg") ? "ogg" : contentType.includes("mp4") || contentType.includes("mp4a") ? "mp4" : "webm";

  try {
    const form = new FormData();
    form.append("file", new Blob([buf], { type: contentType }), `audio.${ext}`);
    form.append("prompt", DOMAIN_PROMPT);
    form.append("response_format", "json");
    const res = await fetch(`${endpoint}/openai/deployments/${DEPLOYMENT}/audio/transcriptions?api-version=${API_VERSION}`, {
      method: "POST",
      headers: { "api-key": key },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      log.error("voice_transcribe_failed", new Error(detail), { status: res.status });
      return NextResponse.json({ error: "transcribe_failed", status: res.status, detail }, { status: 502 });
    }
    const j = (await res.json()) as { text?: string };
    return NextResponse.json({ text: (j.text ?? "").trim() });
  } catch (e) {
    return NextResponse.json({ error: "transcribe_error", detail: e instanceof Error ? e.message : "error" }, { status: 502 });
  }
}
