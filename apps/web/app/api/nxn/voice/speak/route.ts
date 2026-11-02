import { NextRequest } from "next/server";
import WebSocket from "ws";
import { log } from "@/lib/logger";
import { realtimeUrl, sessionUpdate, ttsInstructions } from "@/lib/realtimeVoice";
import { speechRequest, speechUrl, voiceFor, type SpeechLocale } from "@/lib/azureSpeech";
import { engineOrder, emiratiDialectOn, type Engine } from "@/lib/voiceEngines";
import { toEmirati } from "@/lib/emiratiDialect";

export const runtime = "nodejs";

/**
 * Speaks the agent's reply. The client POSTs text (one sentence at a time, as
 * the reply streams — see useVoiceChat) and gets raw PCM16 at 24 kHz back,
 * which it plays through the Web Audio API. The real key stays server-side.
 *
 * TWO ENGINES, ONE FORMAT (2 November 2026).
 *
 * Reported: "the voice mode is poor — not consistent — it stops midway." The
 * voice was gpt-realtime, a conversational model, told to read the text aloud.
 * It read the same reply four different ways on four runs and took 1.5 to 2.5
 * seconds of WebSocket handshake before its first word. So the default engine
 * is now Azure Speech — a text-to-speech engine, deterministic, on the same AI
 * Services resource with the same key and nothing to deploy, measured at
 * 0.55 s to first byte — and the realtime engine is kept as the fallback for a
 * resource that does not carry Speech. Both emit the same bytes, so the client
 * does not know which one spoke. VOICE_TTS_ENGINE chooses ("azure-speech",
 * the default, or "realtime"); a request may also name one, which the probe
 * script uses to compare them.
 *
 * ARABIC IS EMIRATI, AND SPOKEN BY THE LLM VOICE (later the same day). Every
 * Azure Speech Arabic voice reads formal Arabic like a bulletin — "all of them
 * are robotic" — so Arabic goes through the realtime engine with an Emirati
 * accent instruction, and each sentence is first rewritten into Emirati
 * dialect (lib/emiratiDialect; VOICE_TTS_DIALECT_AR=off to stop that). The
 * customer reads the formal reply and hears an Emirati one. English stays on
 * Azure Speech. lib/voiceEngines holds the per-language choice.
 *
 * Short utterances are cached in memory: the spoken acknowledgements ("Checking
 * pricing.") recur every turn and should cost nothing the second time.
 *
 * THE GA REALTIME PROTOCOL (13 October 2026), kept for the fallback. Azure
 * retired the Realtime PREVIEW protocol and every session was being answered
 * with `realtime_beta_access_required`, after which this route closed an EMPTY
 * 200 stream, the client fell back to the device's own voice, and the barge-in
 * detector cut it off a third of a second in. The GA differences:
 * `/openai/v1/realtime?model=<deployment>` with NO api-version, a
 * `session.update` typed "realtime" with the voice and format under
 * `audio.output`, and audio arriving as `response.output_audio.delta`. The
 * response is honest: the socket is opened and the FIRST audio chunk awaited
 * before any status is sent, so a failure is a 502, never a 200 with nothing
 * in it.
 *
 * If neither engine is configured, 501, and the client falls back to on-device
 * SpeechSynthesis so voice still works.
 */
const ENDPOINT = process.env.AZURE_REALTIME_ENDPOINT;
const KEY = process.env.AZURE_REALTIME_KEY;
const DEPLOY = process.env.AZURE_REALTIME_DEPLOYMENT || "gpt-realtime-1.5";
const VOICE = process.env.AZURE_REALTIME_VOICE || "marin";
const SPEECH_URL = speechUrl(ENDPOINT, process.env.AZURE_SPEECH_ENDPOINT);
const SPEECH_KEY = process.env.AZURE_SPEECH_KEY || KEY;
/**
 * How long the first audio may take after the text is sent, and how long the
 * whole handshake may take, before the attempt is given up. Short, because an
 * attempt that fails is retried once and then handed to the other engine, and
 * a customer waiting fifteen seconds for the first word has stopped waiting.
 */
const FIRST_AUDIO_MS = 8000;
const HANDSHAKE_MS = 12000;
/** How long a whole realtime utterance may take. */
const TOTAL_MS = 45000;
const AUDIO_HEADERS = {
  "Content-Type": "application/octet-stream",
  "Cache-Control": "no-store",
  "X-Audio-Format": "pcm16;rate=24000;channels=1",
};

/** Utterances short enough to recur, kept whole. */
const CACHE_MAX_CHARS = 160;
const CACHE_MAX_ENTRIES = 64;
const cache = new Map<string, Uint8Array>();
function remember(k: string, bytes: Uint8Array) {
  if (cache.size >= CACHE_MAX_ENTRIES) { const first = cache.keys().next().value; if (first !== undefined) cache.delete(first); }
  cache.set(k, bytes);
}

function unavailable(detail: string, status = 502) {
  return new Response(JSON.stringify({ error: status === 501 ? "not_configured" : "voice_unavailable", detail: detail.slice(0, 200) }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Azure Speech: one REST call, the audio streamed straight through. The
 * status is known before a byte is sent, so a failure here is reported as a
 * reason rather than a stream that ends early.
 */
async function speakAzure(text: string, locale: SpeechLocale): Promise<Response | string> {
  if (!SPEECH_URL || !SPEECH_KEY) return "speech not configured";
  const voice = voiceFor(locale);
  const key = `${voice}\u0000${text}`;
  const hit = text.length <= CACHE_MAX_CHARS ? cache.get(key) : undefined;
  if (hit) {
    return new Response(hit.slice(), { headers: { ...AUDIO_HEADERS, "X-Voice-Engine": "azure-speech", "X-Voice-Name": voice, "X-Voice-Cache": "hit" } });
  }
  let res: Response;
  try {
    res = await fetch(SPEECH_URL, speechRequest(text, locale, voice, SPEECH_KEY));
  } catch (e) {
    return `speech: ${e instanceof Error ? e.message : "fetch failed"}`;
  }
  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return `speech HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
  }
  const headers = { ...AUDIO_HEADERS, "X-Voice-Engine": "azure-speech", "X-Voice-Name": voice };
  if (text.length <= CACHE_MAX_CHARS) {
    // Short enough to keep: buffer it, remember it, and send it whole.
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length) remember(key, bytes);
    return new Response(bytes, { headers });
  }
  return new Response(res.body, { headers });
}

/**
 * The realtime model as a speaker. `textReady` may still be being written —
 * the Emirati rewrite takes a second or two — so the socket is opened and the
 * session configured meanwhile, and the text is sent the moment both are
 * ready. The handshake and the rewrite overlap instead of queueing.
 */
async function speakRealtime(textReady: Promise<string>, locale: SpeechLocale): Promise<Response | string> {
  if (!ENDPOINT || !KEY) return "realtime not configured";
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
      log.error("voice_speak_failed", new Error(err), { engine: "realtime", deployment: DEPLOY, bytes });
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
        send(sessionUpdate(VOICE, ttsInstructions(locale)));
        break;
      case "session.updated":
        void textReady.then(
          (text) => {
            if (closed) return;
            send({
              type: "conversation.item.create",
              item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
            });
            send({ type: "response.create" });
            // The deadline for the first sound starts now, not at connect time.
            setTimeout(() => settleFirst(bytes > 0), FIRST_AUDIO_MS);
          },
          () => finish("text never arrived")
        );
        break;
      case "response.output_audio.delta":
        if (m.delta) push(new Uint8Array(Buffer.from(m.delta, "base64")));
        break;
      case "response.done": {
        // A response that did not complete is said, even when some audio came —
        // a reply cut short by the model is exactly the thing to be able to read.
        const status = m.response?.status;
        if (bytes === 0) finish(`no audio: ${status ?? "?"} ${JSON.stringify(m.response?.status_details ?? {}).slice(0, 200)}`);
        else if (status && status !== "completed") finish(`${status}: ${JSON.stringify(m.response?.status_details ?? {}).slice(0, 200)}`);
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
    new Promise<boolean>((r) => setTimeout(() => r(bytes > 0), HANDSHAKE_MS + FIRST_AUDIO_MS)),
  ]);
  if (!ok) {
    finish(failure ?? "no audio before the deadline");
    return `realtime: ${failure ?? "no audio before the deadline"}`;
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

  return new Response(stream, { headers: { ...AUDIO_HEADERS, "X-Voice-Engine": "realtime", "X-Voice-Name": VOICE } });
}

export async function POST(req: NextRequest) {
  if (!ENDPOINT || !KEY) return unavailable("no voice engine configured", 501);
  let text = "";
  let locale: SpeechLocale = "en";
  let asked: Engine | null = null;
  try {
    const body = (await req.json()) as { text?: unknown; locale?: unknown; engine?: unknown };
    text = typeof body?.text === "string" ? body.text : "";
    if (body?.locale === "ar") locale = "ar";
    if (body?.engine === "realtime" || body?.engine === "azure-speech") asked = body.engine;
  } catch {
    /* invalid body */
  }
  text = text.trim();
  if (!text) return new Response(JSON.stringify({ error: "empty" }), { status: 400 });
  if (text.length > 4000) text = text.slice(0, 4000);

  // The customer reads the formal reply; in Arabic they hear an Emirati one.
  // The rewrite is started here and awaited only where it is needed, so the
  // realtime handshake can run alongside it. It never rejects.
  const dialect = locale === "ar" && emiratiDialectOn();
  const spokenP = dialect ? toEmirati(text) : Promise.resolve({ text, rewritten: false });

  const order = engineOrder(locale, asked);
  const reasons: string[] = [];
  for (const engine of order) {
    // The LLM voice occasionally produces no audio at all; a second session
    // almost always does, and costs far less than the voice changing mid-reply.
    const attempts = engine === "realtime" ? 2 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const r = engine === "azure-speech"
        ? await speakAzure((await spokenP).text, locale)
        : await speakRealtime(spokenP.then((d) => d.text), locale);
      if (typeof r !== "string") {
        const spoken = await spokenP;
        if (dialect) {
          r.headers.set("X-Voice-Dialect", spoken.rewritten ? "emirati" : "none");
          // What was actually said, for the probe and for anyone debugging by ear.
          r.headers.set("X-Voice-Spoken", encodeURIComponent(spoken.text).slice(0, 1800));
        }
        if (reasons.length) {
          log.warn("voice_speak_recovered", { engine, attempt, after: reasons.join("; ").slice(0, 200) });
          // Said in the response too, so a probe can see a recovery without the server log.
          r.headers.set("X-Voice-Recovered", encodeURIComponent(reasons.join("; ")).slice(0, 400));
        }
        return r;
      }
      reasons.push(`${engine}#${attempt}: ${r}`);
      if (/not configured/.test(r)) break;
      log.error("voice_speak_failed", new Error(r), { engine, attempt, locale, chars: text.length });
    }
  }
  const detail = reasons.join("; ");
  return unavailable(detail, reasons.every((r) => /not configured/.test(r)) ? 501 : 502);
}
