import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/logger";
import { judge, vocabularyPrompt } from "@/lib/transcribeGate";

export const runtime = "nodejs";

/**
 * Accurate speech-to-text for in-chat voice mode. The browser records each
 * utterance and POSTs the audio here; we forward it to Azure OpenAI's
 * gpt-4o-transcribe deployment (/audio/transcriptions) with a vocabulary hint
 * and return the text. The real key stays server-side. If the transcribe
 * deployment isn't configured/available, we return 501/502 and the client
 * falls back to its on-device recognition.
 *
 * NOISE IS NOT A MESSAGE (2 November 2026). Silence and room noise came back
 * as confident-looking sentences — the hint's own phrases, in fact — and were
 * sent to the agent as the customer's words. Token confidences are asked for
 * now and judged (lib/transcribeGate): a guess is returned as empty text with
 * the reason in `X-Transcribe-Rejected`, and the scores ride along in
 * `X-Transcribe-Confidence` either way, so the bar can be tuned from real
 * customers. `?lang=ar|en` picks the hint's language; the language itself is
 * not forced, so a customer who switches language mid-conversation is still
 * heard in the one they used.
 *
 * Requires a `gpt-4o-transcribe` (or whisper) deployment on the resource; set
 * AZURE_TRANSCRIBE_DEPLOYMENT if it's named differently.
 */
const DEPLOYMENT = process.env.AZURE_TRANSCRIBE_DEPLOYMENT || "gpt-4o-transcribe";
const API_VERSION = process.env.AZURE_TRANSCRIBE_API_VERSION || "2025-01-01-preview";

export async function POST(req: NextRequest) {
  const endpoint = process.env.AZURE_REALTIME_ENDPOINT; // same AI Foundry resource
  const key = process.env.AZURE_REALTIME_KEY;
  if (!endpoint || !key) return NextResponse.json({ error: "not_configured" }, { status: 501 });

  const locale: "en" | "ar" = req.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "en";
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return NextResponse.json({ error: "empty_audio" }, { status: 400 });
  const contentType = req.headers.get("content-type") || "audio/webm";
  const ext = contentType.includes("wav") ? "wav" : contentType.includes("ogg") ? "ogg" : contentType.includes("mp4") || contentType.includes("mp4a") ? "mp4" : "webm";

  try {
    const form = new FormData();
    form.append("file", new Blob([buf], { type: contentType }), `audio.${ext}`);
    form.append("prompt", vocabularyPrompt(locale));
    form.append("response_format", "json");
    form.append("include[]", "logprobs");
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
    const j = (await res.json()) as { text?: string; logprobs?: Array<{ token?: string; logprob?: number }> };
    const text = (j.text ?? "").trim();
    const v = judge(text, j.logprobs, locale);
    const headers: Record<string, string> = {};
    if (v.confidence) headers["X-Transcribe-Confidence"] = `avg=${v.confidence.avg.toFixed(3)};min=${v.confidence.min.toFixed(3)};tokens=${v.confidence.tokens}`;
    if (!v.accept && v.reason !== "empty") {
      headers["X-Transcribe-Rejected"] = v.reason ?? "rejected";
      log.info("voice_transcribe_rejected", { reason: v.reason, locale, bytes: buf.byteLength, text: text.slice(0, 80), ...(v.confidence ?? {}) });
      return NextResponse.json({ text: "", rejected: v.reason }, { headers });
    }
    return NextResponse.json({ text }, { headers });
  } catch (e) {
    return NextResponse.json({ error: "transcribe_error", detail: e instanceof Error ? e.message : "error" }, { status: 502 });
  }
}
