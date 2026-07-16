import { NextRequest } from "next/server";
import WebSocket from "ws";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Speaks the agent's reply in the natural gpt-realtime voice (not the robotic
 * browser SpeechSynthesis). The client POSTs the assistant's text; we open a
 * WebSocket to the Azure AI Foundry realtime deployment, drive it as a verbatim
 * text-to-speech engine, and STREAM the raw PCM16 (24 kHz mono) audio back as it
 * is generated. The client plays it via the Web Audio API. The real key stays
 * server-side.
 *
 * Why WebSocket and not WebRTC: the AI Foundry realtime resource rejects the
 * ephemeral key at the generic realtimertc endpoint (401), but the WebSocket
 * transport authenticates fine with the resource api-key — verified end to end.
 *
 * If the realtime deployment isn't configured, we return 501 and the client
 * falls back to on-device SpeechSynthesis so voice still works.
 */
const ENDPOINT = process.env.AZURE_REALTIME_ENDPOINT;
const KEY = process.env.AZURE_REALTIME_KEY;
const DEPLOY = process.env.AZURE_REALTIME_DEPLOYMENT || "gpt-realtime-1.5";
const API_VERSION = process.env.AZURE_REALTIME_API_VERSION || "2025-04-01-preview";
const VOICE = process.env.AZURE_REALTIME_VOICE || "marin";
const TTS_INSTRUCTIONS =
  "You are the spoken voice of an Emirates Post PO Box assistant. Read the user's message aloud EXACTLY as written, in a warm, natural, helpful tone. Do not add, omit, translate, summarise or comment on anything — just voice the text. Speak prices and numbers naturally (e.g. 'AED 695' as 'six hundred ninety-five dirhams').";

export async function POST(req: NextRequest) {
  if (!ENDPOINT || !KEY) {
    return new Response(JSON.stringify({ error: "not_configured" }), { status: 501 });
  }
  let text = "";
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body?.text === "string" ? body.text : "";
  } catch {
    /* invalid body */
  }
  text = text.trim();
  if (!text) return new Response(JSON.stringify({ error: "empty" }), { status: 400 });
  if (text.length > 4000) text = text.slice(0, 4000);

  const host = ENDPOINT.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `wss://${host}/openai/realtime?api-version=${API_VERSION}&deployment=${DEPLOY}`;

  let ws: WebSocket | null = null;
  let finish: (err?: string) => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ws = new WebSocket(url, { headers: { "api-key": KEY } });
      let closed = false;
      const send = (o: unknown) => {
        try { ws?.send(JSON.stringify(o)); } catch { /* socket gone */ }
      };
      const timeout = setTimeout(() => finish("timeout"), 30000);
      finish = (err?: string) => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        try { ws?.close(); } catch { /* ignore */ }
        try { controller.close(); } catch { /* already closed */ }
        if (err) log.error("voice_speak_failed", new Error(err));
      };

      ws.on("message", (raw: Buffer) => {
        let m: { type?: string; delta?: string; error?: unknown };
        try { m = JSON.parse(raw.toString()); } catch { return; }
        switch (m.type) {
          case "session.created":
            send({
              type: "session.update",
              session: {
                modalities: ["audio", "text"],
                voice: VOICE,
                output_audio_format: "pcm16",
                instructions: TTS_INSTRUCTIONS,
                turn_detection: null,
              },
            });
            break;
          case "session.updated":
            send({
              type: "conversation.item.create",
              item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
            });
            send({ type: "response.create", response: { modalities: ["audio", "text"] } });
            break;
          case "response.audio.delta":
            if (m.delta) {
              try { controller.enqueue(new Uint8Array(Buffer.from(m.delta, "base64"))); }
              catch { /* stream closed by client */ }
            }
            break;
          case "response.done":
            finish();
            break;
          case "error":
            finish(JSON.stringify(m.error).slice(0, 200));
            break;
        }
      });
      ws.on("error", (e: Error) => finish(e.message));
      ws.on("close", () => finish());
    },
    cancel() {
      // Client aborted playback (toggled voice off / new reply) — stop generating.
      finish();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Audio-Format": "pcm16;rate=24000;channels=1",
    },
  });
}
