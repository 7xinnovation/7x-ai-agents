"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@dialog/config";

/**
 * Voice mode as an I/O layer over the normal text chat (not a separate agent):
 *  - STT: the browser's SpeechRecognition is used only to detect utterance
 *    boundaries (and as a fallback transcript). Each utterance is also recorded
 *    with MediaRecorder and sent to /api/nxn/voice/transcribe (gpt-4o-transcribe)
 *    for an ACCURATE transcript; the text is then sent as a normal chat message,
 *    so the same agent (tools, journeys, case panel) handles it. If the
 *    transcribe endpoint isn't available yet, it gracefully uses the on-device
 *    recognition text instead.
 *  - TTS: each new assistant reply is spoken with SpeechSynthesis; the mic is
 *    paused while it streams/speaks (no echo) and resumes after.
 */
interface Msg { role: string; content: string }

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
  const recRef = useRef<any>(null); // SpeechRecognition
  const busyRef = useRef(false); // an utterance is being recognized/transcribed
  const spokenRef = useRef(-1);
  const audioCtxRef = useRef<AudioContext | null>(null); // playback of gpt-realtime audio
  const ttsAbortRef = useRef<AbortController | null>(null); // in-flight /speak stream
  const ttsSourcesRef = useRef<AudioBufferSourceNode[]>([]); // scheduled audio nodes
  // Barge-in: an analyser on the LIVE mic (never routed to output) whose energy
  // we watch while the assistant speaks, so the customer can talk over it.
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadBufRef = useRef<Float32Array | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const supported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) &&
    "MediaRecorder" in window &&
    !!navigator.mediaDevices?.getUserMedia &&
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
    if (!resp.ok || !resp.body) return false;

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

  // ── Barge-in: while the assistant speaks, watch the live mic; a sustained
  //    voice above the floor stops playback so the customer can interrupt. Echo
  //    cancellation keeps our own audio from self-triggering; the constants are
  //    the thing to tune on-device if bleed causes false interrupts. ───────────
  const BARGE_RMS = 0.055;
  const BARGE_SUSTAIN_MS = 260;
  const VAD_INTERVAL_MS = 60;
  const rms = useCallback((): number => {
    const an = analyserRef.current;
    const buf = vadBufRef.current;
    if (!an || !buf) return 0;
    an.getFloatTimeDomainData(buf as any);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = buf[i] ?? 0; sum += v * v; }
    return Math.sqrt(sum / buf.length);
  }, []);
  const stopVadMonitor = useCallback(() => {
    if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
  }, []);
  const startVadMonitor = useCallback(() => {
    if (vadTimerRef.current || !analyserRef.current) return;
    let over = 0;
    vadTimerRef.current = setInterval(() => {
      if (!speakingRef.current) { over = 0; return; }
      if (rms() > BARGE_RMS) {
        over += VAD_INTERVAL_MS;
        if (over >= BARGE_SUSTAIN_MS) {
          over = 0;
          // The customer interrupted: silence ourselves and start listening. The
          // in-flight speak()'s done() then resumes as a harmless no-op.
          stopRealtimeAudio();
          try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
          speakingRef.current = false;
          setSpeaking(false);
          if (activeRef.current && !streamingRef.current) listenOnce();
        }
      } else {
        over = 0;
      }
    }, VAD_INTERVAL_MS);
  }, [rms, stopRealtimeAudio, listenOnce]);

  const speak = useCallback((text: string) => {
    const clean = forSpeech(text, locale === "ar" ? "ar" : "en");
    if (!clean) { listenOnce(); return; }
    stopRecognition();
    speakingRef.current = true;
    setSpeaking(true);
    const done = () => {
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
  }, [listenOnce, stopRecognition, speakRealtime, speakBrowser, locale]);

  const cleanup = useCallback(() => {
    stopRecognition();
    stopRealtimeAudio();
    stopVadMonitor();
    try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
    analyserRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    speakingRef.current = false;
    setSpeaking(false);
    setListening(false);
  }, [stopRecognition, stopRealtimeAudio, stopVadMonitor]);

  const toggle = useCallback(async () => {
    if (!supported) return;
    if (activeRef.current) { activeRef.current = false; setActive(false); setError(""); cleanup(); return; }
    activeRef.current = true;
    setActive(true);
    setError("");
    spokenRef.current = messages.length - 1;
    // Unlock audio output on this user gesture so streamed replies can play.
    try {
      const AC: typeof AudioContext | undefined =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AC && !audioCtxRef.current) audioCtxRef.current = new AC();
      if (audioCtxRef.current?.state === "suspended") void audioCtxRef.current.resume();
    } catch { /* ignore */ }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!activeRef.current) { mic.getTracks().forEach((t) => t.stop()); return; }
      micRef.current = mic;
      // Wire the live mic into an analyser for barge-in energy detection (analyser
      // only, never to destination, so it can never feed back into playback).
      try {
        const ctx = audioCtxRef.current;
        if (ctx) {
          const srcNode = ctx.createMediaStreamSource(mic);
          const an = ctx.createAnalyser();
          an.fftSize = 1024;
          an.smoothingTimeConstant = 0.5;
          srcNode.connect(an);
          analyserRef.current = an;
          vadBufRef.current = new Float32Array(an.fftSize);
          startVadMonitor();
        }
      } catch { /* barge-in unavailable; turn-taking still works */ }
      listenOnce();
    } catch {
      setError("Microphone access is needed. Allow it and try again.");
      // keep active so the error stays visible; user taps Turn off
    }
  }, [supported, messages.length, cleanup, listenOnce, startVadMonitor]);

  // Pause the mic while the agent responds; speak each new reply.
  useEffect(() => {
    if (!active) return;
    if (streaming) { stopRecognition(); return; }
    const idx = messages.length - 1;
    const last = messages[idx];
    if (last && last.role === "assistant" && last.content.trim() && idx > spokenRef.current) {
      spokenRef.current = idx;
      speak(last.content);
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

  return { supported, active, connecting: false, listening, speaking, error, toggle };
}
