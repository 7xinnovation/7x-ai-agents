import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * WebRTC signalling proxy for in-chat voice mode's speech-to-text. The browser
 * POSTs its SDP offer here; we mint a short-lived Azure OpenAI Realtime session
 * configured purely as a transcriber (gpt-4o-transcribe + server VAD + a PO-Box
 * domain prompt; never replies), forward the offer to Azure's realtimertc
 * endpoint with the ephemeral key, and return the SDP answer. Media (mic audio)
 * then flows browser<->Azure directly; only signalling passes through us, so the
 * real key never reaches the browser and we can log Azure's exact error.
 */
const TRANSCRIBE_MODEL = process.env.AZURE_REALTIME_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const DOMAIN_PROMPT =
  "Emirates Post PO Box services in the UAE. Likely phrases: rent a new PO Box, renew my PO Box, " +
  "track a shipment, MyBox, MyHome, MyHome Instant, Basic, Premium, Emirate, Dubai, Abu Dhabi, Sharjah, " +
  "Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah, branch, box number, trade license, authorised agent, auto-renewal, Emirates ID.";

export async function POST(req: NextRequest) {
  const endpoint = process.env.AZURE_REALTIME_ENDPOINT;
  const key = process.env.AZURE_REALTIME_KEY;
  const deployment = process.env.AZURE_REALTIME_DEPLOYMENT || "gpt-realtime-1.5";
  const webrtc = process.env.AZURE_REALTIME_WEBRTC || "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc";
  if (!endpoint || !key) return NextResponse.json({ error: "voice_not_configured" }, { status: 501 });

  const offerSdp = await req.text();
  if (!offerSdp || !offerSdp.startsWith("v=")) return NextResponse.json({ error: "missing_offer" }, { status: 400 });

  try {
    // 1) Mint an ephemeral transcribe-only session. audio+text keeps it WebRTC-valid;
    //    create_response=false means it transcribes but never generates a reply.
    const s = await fetch(`${endpoint}/openai/realtimeapi/sessions?api-version=2025-04-01-preview`, {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: deployment,
        voice: process.env.AZURE_REALTIME_VOICE || "alloy",
        modalities: ["audio", "text"],
        instructions: "Transcription only. Never reply.",
        input_audio_transcription: { model: TRANSCRIBE_MODEL, prompt: DOMAIN_PROMPT },
        input_audio_noise_reduction: { type: "near_field" },
        turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600, create_response: false, interrupt_response: false },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!s.ok) {
      const detail = (await s.text().catch(() => "")).slice(0, 300);
      log.error("voice_session_failed", new Error(detail), {});
      return NextResponse.json({ error: "session_failed", status: s.status, detail }, { status: 502 });
    }
    const ek = ((await s.json()) as { client_secret?: { value?: string } }).client_secret?.value;
    if (!ek) return NextResponse.json({ error: "no_ephemeral_key" }, { status: 502 });

    // 2) Forward the SDP offer to Azure's WebRTC endpoint.
    const rtc = await fetch(`${webrtc}?model=${encodeURIComponent(deployment)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ek}`, "Content-Type": "application/sdp" },
      body: offerSdp,
      signal: AbortSignal.timeout(15000),
    });
    const answer = await rtc.text();
    if (!rtc.ok) {
      log.error("voice_rtc_failed", new Error(answer.slice(0, 300)), { status: rtc.status });
      return NextResponse.json({ error: "handshake_failed", status: rtc.status, detail: answer.slice(0, 300) }, { status: 502 });
    }
    return new NextResponse(answer, { headers: { "Content-Type": "application/sdp" } });
  } catch (e) {
    return NextResponse.json({ error: "voice_error", detail: e instanceof Error ? e.message : "error" }, { status: 502 });
  }
}
