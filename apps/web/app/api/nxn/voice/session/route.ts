import { NextRequest, NextResponse } from "next/server";
import { getAgentBySlug } from "@/lib/agents";

export const runtime = "nodejs";

/**
 * Mints a short-lived Azure OpenAI Realtime (GPT Realtime) session for the
 * in-chat voice mode. The real AZURE_REALTIME_KEY stays server-side; the browser
 * only ever receives the ephemeral client_secret (valid ~1 min) which it uses to
 * open the WebRTC connection directly to Azure. Configured with an NXN voice
 * persona: conversational help + guidance, with actual transactions deferred to
 * the on-screen chat (voice-driven journeys/payments are a later phase).
 */
const VOICE = process.env.AZURE_REALTIME_VOICE || "alloy";

function instructions(agentName: string): string {
  return [
    `You are the voice assistant for ${agentName}, Emirates Post's PO Box service in the UAE.`,
    "Speak naturally and briefly, like a warm, efficient human agent: short spoken sentences, no markdown, never read out lists or symbols.",
    "You help customers understand and choose PO Box services: renting a new box, renewing one, tracking a shipment, and questions about packages, branches, pricing and the process.",
    "When the customer wants to actually complete something (rent, renew, pay, upload documents, or anything that needs their account or sign-in), briefly guide them and tell them you'll hand it to the on-screen chat to finish securely. Never take payments or make account changes by voice.",
    "If you are unsure, say so briefly and offer to connect them with the team. Keep replies to a sentence or two unless the customer asks for more detail. Greet the customer warmly when the call starts.",
  ].join(" ");
}

export async function POST(req: NextRequest) {
  const endpoint = process.env.AZURE_REALTIME_ENDPOINT;
  const key = process.env.AZURE_REALTIME_KEY;
  const deployment = process.env.AZURE_REALTIME_DEPLOYMENT || "gpt-realtime-1.5";
  const webrtc = process.env.AZURE_REALTIME_WEBRTC || "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc";
  if (!endpoint || !key) return NextResponse.json({ error: "voice_not_configured" }, { status: 501 });

  const slug = req.nextUrl.searchParams.get("agentSlug") || "nxn-dialog";
  const agent = await getAgentBySlug(slug).catch(() => null);
  const agentName = agent?.definition.name || "NXN";

  try {
    const res = await fetch(`${endpoint}/openai/realtimeapi/sessions?api-version=2025-04-01-preview`, {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: deployment,
        voice: VOICE,
        modalities: ["audio", "text"],
        instructions: instructions(agentName),
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
          create_response: true,
          interrupt_response: true,
        },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return NextResponse.json({ error: "session_failed", detail }, { status: 502 });
    }
    const s = (await res.json()) as { client_secret?: { value?: string; expires_at?: number }; voice?: string };
    if (!s.client_secret?.value) return NextResponse.json({ error: "no_ephemeral_key" }, { status: 502 });
    return NextResponse.json({
      clientSecret: s.client_secret.value,
      expiresAt: s.client_secret.expires_at,
      webrtcUrl: `${webrtc}?model=${encodeURIComponent(deployment)}`,
      voice: s.voice || VOICE,
    });
  } catch (e) {
    return NextResponse.json({ error: "session_error", detail: e instanceof Error ? e.message : "error" }, { status: 502 });
  }
}
