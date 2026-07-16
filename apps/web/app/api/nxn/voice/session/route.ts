import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Mints a short-lived Azure OpenAI Realtime session used PURELY as an accurate
 * speech-to-text engine for in-chat voice mode: the browser streams the mic to
 * it, gpt-realtime does server-side VAD + gpt-4o-transcribe transcription (far
 * better than the browser's Web Speech API), and returns transcript events. It
 * never generates a response (create_response=false, text-only) — the actual
 * conversation is handled by the normal chat agent. The real AZURE_REALTIME_KEY
 * stays server-side; the browser only gets the ephemeral client_secret.
 *
 * A domain prompt biases the transcription toward Emirates Post PO Box terms so
 * phrases like "rent a new PO Box" aren't misheard.
 */
const TRANSCRIBE_MODEL = process.env.AZURE_REALTIME_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const DOMAIN_PROMPT =
  "Emirates Post PO Box services in the UAE. Likely phrases: rent a new PO Box, renew my PO Box, " +
  "track a shipment, MyBox, MyHome, MyHome Instant, Basic, Premium, Emirate, Dubai, Abu Dhabi, Sharjah, " +
  "Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah, branch, box number, trade license, authorised agent, auto-renewal, Emirates ID.";

export async function POST(_req: NextRequest) {
  const endpoint = process.env.AZURE_REALTIME_ENDPOINT;
  const key = process.env.AZURE_REALTIME_KEY;
  const deployment = process.env.AZURE_REALTIME_DEPLOYMENT || "gpt-realtime-1.5";
  const webrtc = process.env.AZURE_REALTIME_WEBRTC || "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc";
  if (!endpoint || !key) return NextResponse.json({ error: "voice_not_configured" }, { status: 501 });

  try {
    const res = await fetch(`${endpoint}/openai/realtimeapi/sessions?api-version=2025-04-01-preview`, {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: deployment,
        modalities: ["text"],
        instructions: "Transcription only. Do not reply.",
        input_audio_transcription: { model: TRANSCRIBE_MODEL, prompt: DOMAIN_PROMPT },
        input_audio_noise_reduction: { type: "near_field" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
          create_response: false,
          interrupt_response: false,
        },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return NextResponse.json({ error: "session_failed", detail }, { status: 502 });
    }
    const s = (await res.json()) as { client_secret?: { value?: string; expires_at?: number } };
    if (!s.client_secret?.value) return NextResponse.json({ error: "no_ephemeral_key" }, { status: 502 });
    return NextResponse.json({
      clientSecret: s.client_secret.value,
      expiresAt: s.client_secret.expires_at,
      webrtcUrl: `${webrtc}?model=${encodeURIComponent(deployment)}`,
    });
  } catch (e) {
    return NextResponse.json({ error: "session_error", detail: e instanceof Error ? e.message : "error" }, { status: 502 });
  }
}
