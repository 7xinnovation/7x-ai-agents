import { NextRequest } from "next/server";
import WebSocket from "ws";
import { log } from "@/lib/logger";
import { realtimeUrl, sessionUpdate } from "@/lib/realtimeVoice";

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
 * THE GA PROTOCOL (13 October 2026). Reported: "it replies with 2 words and then
 * disconnects and goes back to listening." The voice had not said two words; it
 * had said none. Azure retired the Realtime PREVIEW protocol (deprecated 30 April
 * 2026) and every session here was being answered with
 *
 *   realtime_beta_access_required: The Realtime preview API is no longer
 *   available for this request. Please migrate from the preview API to the v1 API.
 *
 * — after which this route closed an EMPTY 200 stream, the client took the
 * silence as "played nothing" and fell back to the device's own voice, and the
 * barge-in detector, hearing that voice through the microphone, cut it off a
 * third of a second in. Hence two words. The GA differences are small and all
 * here: `/openai/v1/realtime?model=<deployment>` with NO api-version, a
 * `session.update` that carries `type: "realtime"` with the voice and format
 * under `audio.output`, and audio arriving as `response.output_audio.delta`.
 *
 * The response is also honest now: the socket is opened and the FIRST audio
 * chunk awaited before any status is sent, so a failure is a 502 the client and
 * a curl can both see, never a 200 with nothing in it.
 *
 * If the realtime deployment isn't configured, we return 501 and the client
 * falls back to on-device SpeechSynthesis so voice still works.
 */
const ENDPOINT = process.env.AZURE_REALTIME_ENDPOINT;
const KEY = process.env.AZURE_REALTIME_KEY;
const DEPLOY = process.env.AZURE_REALTIME_DEPLOYMENT || "gpt-realtime-1.5";
const VOICE = process.env.AZURE_REALTIME_VOICE || "marin";
/** How long the first audio may take to arrive before the request is a 502. */
const FIRST_AUDIO_MS = 15000;
/** How long a whole utterance may take. */
const TOTAL_MS = 45000;
/**
 * "EXACTLY as written" was doing more work than intended.
 *
 * Emirates Post, 13 September: the voice was saying "dot dot dot". Told to read
 * the text exactly, and handed an ellipsis, it did. The text is cleaned before
 * it gets here now — see forSpeech in useVoiceChat — but the instruction is the
 * belt to that braces: punctuation is pacing, and pacing is not a word.
 */
const TTS_INSTRUCTIONS =
  "You are Mira, the spoken voice of Emirates Post's PO Box assistant. Read the user's message aloud EXACTLY as written, in a warm, natural, helpful tone. Do not add, omit, translate, summarise or comment on anything — just voice the text. " +
  "NEVER SPEAK PUNCTUATION ALOUD. A full stop, an ellipsis, a comma, a dash, an asterisk or a bracket is pacing, not a word: pause for it, never name it. Never say 'dot', 'dot dot dot', 'asterisk', 'dash', 'hyphen' or 'bracket'. If a line contains nothing but punctuation, say nothing for it. " +
  "Speak prices and numbers naturally (e.g. 'AED 695' as 'six hundred ninety-five dirhams'). Read nothing but speech: no markup, no symbols, no sound effects, no tones.";

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

  const ws = new WebSocket(realtimeUrl(ENDPOINT, DEPLOY), { headers: { "api-key": KEY } });
  /** Audio that arrived before the response stream existed to carry it. */
  const pending: Uint8Array[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let failure: string | null = null;
  let bytes = 0;
  let settleFirst: (ok: boolean) => void = () => {};
  const first = new Promise<boolean>((r) => { settleFirst = r; });

  const send = (o: unknown) => {
    try { ws.send(JSON.stringify(o)); } catch { /* socket gone */ }
  };
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const finish = (err?: string) => {
    if (closed) return;
    closed = true;
    if (timeout) clearTimeout(timeout);
    if (err) {
      failure = err;
      log.error("voice_speak_failed", new Error(err), { deployment: DEPLOY, bytes });
    }
    try { ws.close(); } catch { /* ignore */ }
    try { controller?.close(); } catch { /* already closed */ }
    settleFirst(bytes > 0);
  };
  const push = (chunk: Uint8Array) => {
    if (closed || !chunk.length) return;
    bytes += chunk.length;
    if (controller) {
      try { controller.enqueue(chunk); } catch { /* stream closed by client */ }
    } else {
      pending.push(chunk);
    }
    settleFirst(true);
  };

  timeout = setTimeout(() => finish("timeout"), TOTAL_MS);
  ws.on("message", (raw: Buffer) => {
    let m: { type?: string; delta?: string; error?: unknown; response?: { status?: string; status_details?: unknown } };
    try { m = JSON.parse(raw.toString()); } catch { return; }
    switch (m.type) {
      case "session.created":
        send(sessionUpdate(VOICE, TTS_INSTRUCTIONS));
        break;
      case "session.updated":
        send({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
        });
        send({ type: "response.create" });
        break;
      case "response.output_audio.delta":
        if (m.delta) push(new Uint8Array(Buffer.from(m.delta, "base64")));
        break;
      case "response.done": {
        // A response that "completed" with no audio is a failure the model did
        // not call one; say what it did say, so the next retirement is readable.
        const status = m.response?.status;
        if (bytes === 0) finish(`no audio: ${status ?? "?"} ${JSON.stringify(m.response?.status_details ?? {}).slice(0, 200)}`);
        else finish();
        break;
      }
      case "error":
        finish(JSON.stringify(m.error).slice(0, 300));
        break;
    }
  });
  ws.on("unexpected-response", (_r, res) => finish(`HTTP ${res.statusCode ?? "?"} at handshake`));
  ws.on("error", (e: Error) => finish(e.message));
  ws.on("close", () => finish());

  const ok = await Promise.race([
    first,
    new Promise<boolean>((r) => setTimeout(() => r(bytes > 0), FIRST_AUDIO_MS)),
  ]);
  if (!ok) {
    finish(failure ?? "no audio before the deadline");
    return new Response(JSON.stringify({ error: "voice_unavailable", detail: (failure ?? "").slice(0, 200) }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const chunk of pending) {
        try { c.enqueue(chunk); } catch { /* closed */ }
      }
      pending.length = 0;
      if (closed) { try { c.close(); } catch { /* already closed */ } }
    },
    cancel() {
      // Client aborted playback (toggled voice off / interrupted) — stop generating.
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
