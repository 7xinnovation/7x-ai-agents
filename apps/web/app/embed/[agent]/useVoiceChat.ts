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

function forSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ". ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, " ")
    .replace(/^\s*[-•]\s*/gm, ", ")
    .replace(/\s+/g, " ")
    .trim();
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
  const micRef = useRef<MediaStream | null>(null);
  const recRef = useRef<any>(null); // SpeechRecognition
  const busyRef = useRef(false); // an utterance is being recognized/transcribed
  const spokenRef = useRef(-1);
  const audioCtxRef = useRef<AudioContext | null>(null); // playback of gpt-realtime audio
  const ttsAbortRef = useRef<AbortController | null>(null); // in-flight /speak stream
  const ttsSourcesRef = useRef<AudioBufferSourceNode[]>([]); // scheduled audio nodes

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
      if (text) send(text);
      // If nothing was sent, keep listening; otherwise the effect resumes after the reply.
      if (!text && activeRef.current && !speakingRef.current && !streamingRef.current) listenOnce();
    };
    setListening(true);
    try { rec.start(); } catch { busyRef.current = false; recRef.current = null; setListening(false); }
  }, [locale, send]);

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
    let ctx = audioCtxRef.current;
    if (!ctx) { ctx = new AC(); audioCtxRef.current = ctx; }
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
        const buf = ctx.createBuffer(1, n, 24000);
        const ch = buf.getChannelData(0);
        const dv = new DataView(bytes.buffer, bytes.byteOffset, usable);
        for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        const startAt = Math.max(scheduled, ctx.currentTime);
        try { src.start(startAt); } catch { /* ctx closed */ }
        ttsSourcesRef.current.push(src);
        scheduled = startAt + buf.duration;
        played = true;
      }
    } catch { /* aborted or stream error */ }
    if (!played) return false;
    const remaining = Math.max(0, scheduled - ctx.currentTime);
    await new Promise((r) => setTimeout(r, remaining * 1000 + 80));
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
    const clean = forSpeech(text);
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
  }, [listenOnce, stopRecognition, speakRealtime, speakBrowser]);

  const cleanup = useCallback(() => {
    stopRecognition();
    stopRealtimeAudio();
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    speakingRef.current = false;
    setSpeaking(false);
    setListening(false);
  }, [stopRecognition, stopRealtimeAudio]);

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
      speak(last.content);
    } else if (!speakingRef.current && !busyRef.current && micRef.current) {
      listenOnce();
    }
  }, [active, streaming, messages, speak, listenOnce, stopRecognition]);

  useEffect(() => () => {
    activeRef.current = false;
    cleanup();
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
  }, [cleanup]);

  return { supported, active, connecting: false, listening, speaking, error, toggle };
}
