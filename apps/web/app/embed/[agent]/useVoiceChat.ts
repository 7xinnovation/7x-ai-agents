"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@dialog/config";
import { nativeVoiceAllowed } from "./nativeBridge";

/**
 * Voice mode as an I/O layer over the normal text chat (not a separate agent):
 *  - STT: the browser's SpeechRecognition is used only to detect utterance
 *    boundaries (and as a fallback transcript). Each utterance is also recorded
 *    with MediaRecorder and sent to /api/nxn/voice/transcribe (gpt-4o-transcribe)
 *    for an ACCURATE transcript; the text is then sent as a normal chat message,
 *    so the same agent (tools, journeys, case panel) handles it. If the
 *    transcribe endpoint isn't available yet, it gracefully uses the on-device
 *    recognition text instead.
 *  - TTS: each new assistant reply is spoken with the gpt-realtime voice streamed
 *    from /api/nxn/voice/speak (SpeechSynthesis if that is unavailable); the mic
 *    is paused while it streams/speaks (no echo) and resumes after.
 *  - Barge-in: while the assistant speaks, the recogniser listens for the
 *    CUSTOMER — words that are not the assistant's own coming back through the
 *    microphone — and only then stops the voice and hands the turn over. See
 *    heardTheCustomer. A tap on the voice bar interrupts too.
 */
interface Msg { role: string; content: string; pulse?: boolean }

/** The account pulse is a long visual summary; spoken aloud it is a monologue.
 *  Voice reads only its intro sentence and lets the panel/cards carry the rest. */
function pulseIntro(text: string): string {
  const m = text.match(/^[\s\S]*?[.!?؟۔](\s|$)/);
  return (m ? m[0] : text.split(/\n/)[0] ?? text).trim();
}

/**
 * The reply, as something to say out loud rather than something to render.
 *
 * Emirates Post, 13 September: "sometimes the agent mentions the dot. For
 * example if the sentence says pobox is rented... it mentions dot dot dot."
 *
 * It was reading our own punctuation back. A fenced block — a ```summary card, a
 * ```buttons list — was being replaced by ". ", so a reply that put a card
 * between two sentences became "...rented. . . Which would you like?", and a
 * voice told to read the text EXACTLY as written read exactly that. The same
 * went for an ellipsis the model wrote itself, for the hyphens left behind when
 * markdown was stripped, and for a bare URL, which is unspeakable in any voice.
 *
 * So punctuation is now pacing rather than text: runs of dots collapse to one
 * full stop, orphaned punctuation goes, and anything that is not words is
 * removed before the sentence reaches the voice rather than being explained to
 * it afterwards.
 */
export function forSpeech(md: string, locale: "en" | "ar" = "en"): string {
  return (
    md
      // A fenced block is a card, not a sentence. It becomes a pause.
      .replace(/```[\s\S]*?```/g, " . ")
      // Link text is speakable; the URL behind it is not.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Not deleted outright: "read more at https://..." would become "read more
      // at now", which is worse than saying where it is.
      .replace(/\bhttps?:\/\/\S+/gi, locale === "ar" ? " الرابط أدناه " : " the link below ")
      .replace(/\bwww\.\S+/gi, locale === "ar" ? " الرابط أدناه " : " the link below ")
      // Markdown furniture.
      .replace(/[*_`#>|~]/g, " ")
      .replace(/^\s*[-•]\s*/gm, ", ")
      // A table's row of dashes, and the em-dashes markdown leaves behind.
      .replace(/[-–—]{2,}/g, " ")
      .replace(/\s[-–—]\s/g, ", ")
      // THE REPORTED BUG: an ellipsis, or the dots our own block substitution
      // leaves behind, read aloud as "dot dot dot".
      .replace(/…/g, ". ")
      .replace(/(?:\s*\.\s*){2,}/g, ". ")
      .replace(/\s+/g, " ")
      // Punctuation with no words left around it.
      .replace(/\s+([.,!?؟،])/g, "$1")
      .replace(/^[\s.,;:،؛]+/, "")
      .replace(/([.,!?؟،])\1+/g, "$1")
      .trim()
      // A reply that was nothing but a card has nothing to say.
      .replace(/^[.\s,]*$/, "")
  );
}

/**
 * BARGE-IN IS A QUESTION OF WORDS, NOT VOLUME.
 *
 * Reported 12 October: "it replies with 2 words and then disconnects and goes
 * back to listening." The interrupt detector was an energy meter on the
 * microphone — any sustained sound above a floor, a third of a second long, was
 * taken for the customer. The assistant's own voice coming out of the speakers
 * is a sustained sound above that floor. Echo cancellation hides most of it
 * when the voice is played through Web Audio, and none of it when the device's
 * own speech engine is speaking (the fallback the retired preview API had
 * forced on everybody), and in a room with a second laptop playing audio it
 * does not matter which: the meter tripped on nearly every reply, a few hundred
 * milliseconds in.
 *
 * Volume cannot tell the customer from the assistant. Words can: the recogniser
 * runs while the voice speaks, and what it hears is compared with what is being
 * said. The assistant's own voice comes back as its own words; the customer
 * brings words of their own. Numbers are left out of the comparison, because
 * the voice says "six hundred ninety-five dirhams" where the text says "AED
 * 695", and so are the little words every sentence shares.
 */
const SHARED_WORDS = new Set([
  // English function words and the number words the voice turns figures into.
  "the", "and", "for", "you", "your", "with", "that", "this", "are", "can", "will", "have", "has", "our", "one", "two",
  "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "point", "dirham", "dirhams", "aed", "per", "year", "years",
  // Arabic equivalents.
  "في", "من", "على", "إلى", "هذا", "هذه", "التي", "الذي", "درهم", "درهماً", "دراهم", "مئة", "مائة", "ألف", "سنة", "سنوات",
]);

/** The words of a sentence, lowercased, with everything else dropped. */
export function bagOfWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

/**
 * Did the microphone hear the CUSTOMER, or the assistant's own voice coming back?
 *
 * True when what was heard carries at least two content words that are not in
 * what the assistant is saying, and those are at least half of its content
 * words. Short fragments and anything that is mostly the spoken text are the
 * voice itself, and are ignored.
 */
export function heardTheCustomer(heard: string, spoken: string): boolean {
  const said = bagOfWords(spoken);
  const words = [...bagOfWords(heard)].filter((w) => w.length >= 3 && !/^\p{N}+$/u.test(w) && !SHARED_WORDS.has(w));
  if (words.length < 2) return false;
  const novel = words.filter((w) => !said.has(w));
  return novel.length >= 2 && novel.length * 2 >= words.length;
}

/**
 * Where the recogniser may run while the assistant speaks.
 *
 * On desktop Chromium it is a second, silent listener. On Android the system
 * recogniser takes audio focus from whatever is playing, and on Apple devices
 * every start is announced with a tone; in both the cure would be the disease.
 * Those customers interrupt with a tap on the voice bar instead.
 */
function autoBargeIn(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  if (/android|iphone|ipad|ipod/i.test(ua)) return false;
  if (/apple/i.test(navigator.vendor ?? "")) return false;
  return true;
}

function pickMime(): string {
  const MR = typeof window !== "undefined" ? (window as any).MediaRecorder : undefined;
  if (!MR?.isTypeSupported) return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MR.isTypeSupported(m)) return m;
  }
  return "";
}

export function useVoiceChat(opts: {
  agentSlug: string;
  locale: Locale;
  messages: Msg[];
  streaming: boolean;
  send: (text: string) => void;
}) {
  const { locale, messages, streaming, send } = opts;
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");

  const activeRef = useRef(false);
  const streamingRef = useRef(false);
  const speakingRef = useRef(false);
  streamingRef.current = streaming;
  // The parent hands a fresh `send` closure every render; hold it in a ref so the
  // callback graph (listenOnce, the watchdog interval) stays stable instead of
  // being rebuilt and re-armed on every render.
  const sendRef = useRef(send);
  sendRef.current = send;
  const micRef = useRef<MediaStream | null>(null);
  const recRef = useRef<any>(null); // SpeechRecognition, capturing an utterance
  const busyRef = useRef(false); // an utterance is being recognized/transcribed
  const spokenRef = useRef(-1);
  const audioCtxRef = useRef<AudioContext | null>(null); // playback of gpt-realtime audio
  const ttsAbortRef = useRef<AbortController | null>(null); // in-flight /speak stream
  const ttsSourcesRef = useRef<AudioBufferSourceNode[]>([]); // scheduled audio nodes
  // Barge-in: a second recogniser that runs only while the assistant speaks, and
  // the text being spoken, which is what its hearing is compared against.
  const bargeRecRef = useRef<any>(null);
  const spokenTextRef = useRef("");
  const warnedRef = useRef(false);

  const supported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) &&
    "MediaRecorder" in window &&
    !!navigator.mediaDevices?.getUserMedia &&
    // A WebView reports a microphone it may not be permitted to open; asking for
    // one the app has no usage description for kills the app. See
    // nativeVoiceAllowed.
    nativeVoiceAllowed() &&
    ("AudioContext" in window || "webkitAudioContext" in window || "speechSynthesis" in window);

  const stopRecognition = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    busyRef.current = false;
    if (rec) { try { rec.onend = null; rec.onresult = null; rec.abort(); } catch { /* ignore */ } }
    setListening(false);
  }, []);

  // One utterance: recognise (for endpointing + fallback) while recording, then
  // transcribe the recording accurately and send the text.
  const listenOnce = useCallback(() => {
    if (!activeRef.current || speakingRef.current || streamingRef.current || busyRef.current || !micRef.current) return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    busyRef.current = true;
    let fallback = "";
    let recorder: any = null;
    const chunks: BlobPart[] = [];
    const mime = pickMime();
    try {
      recorder = new (window as any).MediaRecorder(micRef.current, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (e: any) => { if (e.data?.size) chunks.push(e.data); };
      recorder.start();
    } catch { recorder = null; }

    const rec = new SR();
    recRef.current = rec;
    rec.lang = locale === "ar" ? "ar-SA" : "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => { fallback = (e?.results?.[0]?.[0]?.transcript ?? "").trim(); };
    rec.onerror = () => { /* onend follows */ };
    rec.onend = async () => {
      recRef.current = null;
      setListening(false);
      let blob: Blob | null = null;
      if (recorder && recorder.state !== "inactive") {
        blob = await new Promise<Blob>((res) => { recorder.onstop = () => res(new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" })); try { recorder.stop(); } catch { res(new Blob(chunks)); } });
      }
      let text = "";
      if (blob && blob.size > 1400) {
        try {
          const r = await fetch("/api/nxn/voice/transcribe", { method: "POST", headers: { "Content-Type": blob.type || "audio/webm" }, body: blob });
          if (r.ok) text = ((await r.json())?.text ?? "").trim();
        } catch { /* fall back below */ }
      }
      if (!text) text = fallback; // graceful fallback to on-device recognition
      busyRef.current = false;
      if (text) sendRef.current(text);
      // If nothing was sent, keep listening; otherwise the effect resumes after the reply.
      if (!text && activeRef.current && !speakingRef.current && !streamingRef.current) listenOnce();
    };
    setListening(true);
    try { rec.start(); } catch { busyRef.current = false; recRef.current = null; setListening(false); }
  }, [locale]);

  const stopRealtimeAudio = useCallback(() => {
    try { ttsAbortRef.current?.abort(); } catch { /* ignore */ }
    ttsAbortRef.current = null;
    for (const s of ttsSourcesRef.current) { try { s.stop(); } catch { /* already stopped */ } }
    ttsSourcesRef.current = [];
  }, []);

  /** The barge-in recogniser, off. */
  const stopBargeListener = useCallback(() => {
    const rec = bargeRecRef.current;
    bargeRecRef.current = null;
    if (rec) { try { rec.onend = null; rec.onresult = null; rec.onerror = null; rec.abort(); } catch { /* ignore */ } }
  }, []);

  /**
   * The customer interrupted — by speaking over the assistant, or by tapping
   * the voice bar. Silence ourselves and start listening. The in-flight
   * speak()'s done() then resumes as a harmless no-op.
   */
  const interrupt = useCallback(() => {
    if (!speakingRef.current) return;
    stopBargeListener();
    stopRealtimeAudio();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    speakingRef.current = false;
    setSpeaking(false);
    if (activeRef.current && !streamingRef.current) listenOnce();
  }, [stopBargeListener, stopRealtimeAudio, listenOnce]);

  /** The barge-in recogniser, on: it listens for the customer while the assistant speaks. */
  const startBargeListener = useCallback(() => {
    if (bargeRecRef.current || !speakingRef.current || !activeRef.current || !autoBargeIn()) return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    let rec: any;
    try { rec = new SR(); } catch { return; }
    rec.lang = locale === "ar" ? "ar-SA" : "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      let heard = "";
      const results = e?.results ?? [];
      for (let i = e?.resultIndex ?? 0; i < results.length; i++) heard += " " + (results[i]?.[0]?.transcript ?? "");
      if (heardTheCustomer(heard, spokenTextRef.current)) interrupt();
    };
    rec.onerror = () => { /* onend follows */ };
    rec.onend = () => {
      if (bargeRecRef.current !== rec) return;
      bargeRecRef.current = null;
      // Chromium ends a continuous recognition on its own after a silence; while
      // the assistant is still talking, listen again.
      if (speakingRef.current && activeRef.current) setTimeout(startBargeListener, 150);
    };
    bargeRecRef.current = rec;
    try { rec.start(); } catch { bargeRecRef.current = null; }
  }, [locale, interrupt]);

  // Speak with the natural gpt-realtime voice: stream PCM16 (24 kHz mono) from
  // /api/nxn/voice/speak and play it via Web Audio, scheduling chunks back to
  // back. Returns true if audio actually played; false to fall back to on-device
  // SpeechSynthesis (e.g. the realtime deployment isn't configured).
  const speakRealtime = useCallback(async (text: string): Promise<boolean> => {
    const AC: typeof AudioContext | undefined =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return false;
    /**
     * THE RANDOM TONE.
     *
     * Emirates Post, 13 September: "there is a random tone happening during the
     * audio responses."
     *
     * The voice arrives as PCM16 at 24 kHz in small chunks, and each chunk was
     * turned into its own AudioBuffer declared at 24 kHz and played in a context
     * running at the device's native rate — 48 kHz on almost everything. The Web
     * Audio API resamples such a buffer, and it resamples EACH ONE INDEPENDENTLY,
     * with no knowledge of the samples either side of it. Every chunk boundary
     * therefore gets a small discontinuity, and the boundaries arrive at a steady
     * rate, so what should be a click you would never notice becomes a periodic
     * buzz sitting under the speech. A tone.
     *
     * So the context is opened AT the audio's own rate and nothing is resampled.
     * Browsers that refuse the hint fall back to the old behaviour, which is no
     * worse than today; `sampleRate` below is read back rather than assumed.
     */
    let ctx = audioCtxRef.current;
    if (!ctx) {
      try { ctx = new AC({ sampleRate: 24000 }); }
      catch { ctx = new AC(); }
      audioCtxRef.current = ctx;
    }
    try { if (ctx.state === "suspended") await ctx.resume(); } catch { /* ignore */ }

    const controller = new AbortController();
    ttsAbortRef.current = controller;
    let resp: Response;
    try {
      resp = await fetch("/api/nxn/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
    } catch { return false; }
    if (!resp.ok || !resp.body) {
      // Said once per session, so a silent fallback to the device voice is at
      // least visible in the console — the preview API's retirement was not.
      if (!warnedRef.current) {
        warnedRef.current = true;
        console.warn(`[voice] the natural voice is unavailable (${resp.status}); using the device's own voice`);
      }
      return false;
    }

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const reader = resp.body.getReader();
    let scheduled = ctx.currentTime + 0.12;
    let carry: Uint8Array | null = null;
    let played = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        let bytes: Uint8Array = value;
        if (carry) {
          const merged = new Uint8Array(carry.length + value.length);
          merged.set(carry); merged.set(value, carry.length);
          bytes = merged; carry = null;
        }
        const usable = bytes.length - (bytes.length % 2);
        if (usable < bytes.length) carry = bytes.slice(usable);
        if (usable <= 0) continue;
        const n = usable / 2;
        // 24 kHz because that is what the bytes ARE. When the context runs at
        // the same rate -- which is why it is opened that way above -- the
        // buffer is played sample for sample and nothing is resampled.
        const buf = ctx.createBuffer(1, n, 24000);
        const ch = buf.getChannelData(0);
        const dv = new DataView(bytes.buffer, bytes.byteOffset, usable);
        for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        // An underrun -- the network stalling for longer than the audio we have
        // buffered -- used to butt the next chunk straight onto the playhead,
        // joining two unrelated waveforms mid-cycle. Restart with the same small
        // lead the stream opened with instead, so a gap sounds like a gap.
        const startAt = scheduled >= ctx.currentTime ? scheduled : ctx.currentTime + 0.03;
        try { src.start(startAt); } catch { /* ctx closed */ }
        ttsSourcesRef.current.push(src);
        scheduled = startAt + buf.duration;
        played = true;
      }
    } catch { /* aborted or stream error */ }
    if (!played) { try { gain.disconnect(); } catch { /* ignore */ } return false; }
    // Interrupted: the sources are already stopped; do not sit out the rest of
    // an utterance nobody is hearing.
    if (controller.signal.aborted) { try { gain.disconnect(); } catch { /* ignore */ } return true; }
    const remaining = Math.max(0, scheduled - ctx.currentTime);
    await new Promise((r) => setTimeout(r, remaining * 1000 + 80));
    // One gain node per reply, and the context outlives the reply.
    try { gain.disconnect(); } catch { /* ignore */ }
    return true;
  }, []);

  const speakBrowser = useCallback((text: string, done: () => void) => {
    try {
      if (!("speechSynthesis" in window)) { done(); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = locale === "ar" ? "ar-SA" : "en-US";
      u.rate = 1.03;
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { done(); }
  }, [locale]);

  const speak = useCallback((text: string) => {
    const clean = forSpeech(text, locale === "ar" ? "ar" : "en");
    if (!clean) { listenOnce(); return; }
    stopRecognition();
    speakingRef.current = true;
    setSpeaking(true);
    spokenTextRef.current = clean;
    startBargeListener();
    const done = () => {
      stopBargeListener();
      speakingRef.current = false;
      setSpeaking(false);
      ttsAbortRef.current = null;
      ttsSourcesRef.current = [];
      if (activeRef.current && !streamingRef.current) listenOnce();
    };
    void speakRealtime(clean)
      .then((ok) => {
        if (ok) { done(); return; }
        if (activeRef.current) speakBrowser(clean, done);
        else done();
      })
      .catch(() => { if (activeRef.current) speakBrowser(clean, done); else done(); });
  }, [listenOnce, stopRecognition, startBargeListener, stopBargeListener, speakRealtime, speakBrowser, locale]);

  const cleanup = useCallback(() => {
    stopRecognition();
    stopBargeListener();
    stopRealtimeAudio();
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    speakingRef.current = false;
    setSpeaking(false);
    setListening(false);
  }, [stopRecognition, stopBargeListener, stopRealtimeAudio]);

  const toggle = useCallback(async () => {
    if (!supported) return;
    if (activeRef.current) { activeRef.current = false; setActive(false); setError(""); cleanup(); return; }
    activeRef.current = true;
    setActive(true);
    setError("");
    spokenRef.current = messages.length - 1;
    // Unlock audio output on this user gesture so streamed replies can play.
    // CRITICAL: open it at 24 kHz — the rate the gpt-realtime PCM actually is.
    // This context is created HERE, before speakRealtime runs, so if we opened it
    // at the device default (48 kHz) every 24 kHz chunk would be resampled
    // independently and the chunk boundaries would sit under the speech as a
    // periodic beep. Matching the rate means the buffers play sample-for-sample.
    try {
      const AC: typeof AudioContext | undefined =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AC && !audioCtxRef.current) {
        try { audioCtxRef.current = new AC({ sampleRate: 24000 }); }
        catch { audioCtxRef.current = new AC(); }
      }
      if (audioCtxRef.current?.state === "suspended") void audioCtxRef.current.resume();
    } catch { /* ignore */ }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!activeRef.current) { mic.getTracks().forEach((t) => t.stop()); return; }
      micRef.current = mic;
      listenOnce();
    } catch {
      setError("Microphone access is needed. Allow it and try again.");
      // keep active so the error stays visible; user taps Turn off
    }
  }, [supported, messages.length, cleanup, listenOnce]);

  // Pause the mic while the agent responds; speak each new reply.
  useEffect(() => {
    if (!active) return;
    if (streaming) { stopRecognition(); return; }
    const idx = messages.length - 1;
    const last = messages[idx];
    if (last && last.role === "assistant" && last.content.trim() && idx > spokenRef.current) {
      spokenRef.current = idx;
      // The account pulse is a long visual summary — voice speaks only its intro
      // line ("Here is a snapshot of your account.") and leaves the rest to read.
      speak(last.pulse ? pulseIntro(last.content) : last.content);
    } else if (!speakingRef.current && !busyRef.current && micRef.current) {
      listenOnce();
    }
  }, [active, streaming, messages, speak, listenOnce, stopRecognition]);

  // Resume watchdog: never leave the mic stranded. If nothing is happening (not
  // speaking, thinking, or capturing), reopen it. A backstop for any missed
  // state transition (a stalled TTS, an interrupted turn).
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (!activeRef.current) return;
      if (speakingRef.current || streamingRef.current || busyRef.current) return;
      if (recRef.current) return; // already listening
      if (micRef.current) listenOnce();
    }, 1500);
    return () => clearInterval(id);
  }, [active, listenOnce]);

  useEffect(() => () => {
    activeRef.current = false;
    cleanup();
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
  }, [cleanup]);

  return { supported, active, connecting: false, listening, speaking, error, toggle, interrupt };
}
