"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@dialog/config";

/**
 * Voice mode as an I/O layer over the normal text chat (NOT a separate agent):
 *  - Speech-to-text: the mic is streamed over WebRTC to an Azure OpenAI Realtime
 *    session running purely as a transcriber (gpt-4o-transcribe + server VAD +
 *    a PO-Box domain prompt) — far more accurate than the browser's Web Speech
 *    API. Each finished utterance is sent as a normal chat message via send(),
 *    so the same agent (tools, journeys, case panel) handles it.
 *  - Text-to-speech: each new assistant reply is spoken with the browser's
 *    SpeechSynthesis. The mic is muted while the assistant streams/speaks (no
 *    echo/feedback) and re-enabled after.
 * No popup; the realtime connection is invisible plumbing.
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

export function useVoiceChat(opts: {
  agentSlug: string;
  locale: Locale;
  messages: Msg[];
  streaming: boolean;
  send: (text: string) => void;
}) {
  const { agentSlug, locale, messages, streaming, send } = opts;
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");

  const activeRef = useRef(false);
  const streamingRef = useRef(false);
  const speakingRef = useRef(false);
  streamingRef.current = streaming;
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const spokenRef = useRef(-1);
  const connectingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "RTCPeerConnection" in window &&
    !!navigator.mediaDevices?.getUserMedia;

  const setMicEnabled = useCallback((on: boolean) => {
    micRef.current?.getAudioTracks().forEach((t) => { t.enabled = on; });
    setListening(on);
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    connectingRef.current = false;
    try { dcRef.current?.close(); } catch { /* ignore */ }
    try { pcRef.current?.close(); } catch { /* ignore */ }
    micRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null; pcRef.current = null; micRef.current = null;
    setListening(false);
  }, []);

  const onEvent = useCallback((ev: any) => {
    if (ev?.type === "conversation.item.input_audio_transcription.completed") {
      const t = (ev.transcript ?? "").trim();
      // Ignore anything captured while the assistant streams/speaks (echo/overlap).
      if (t && !speakingRef.current && !streamingRef.current) send(t);
    }
  }, [send]);

  const connect = useCallback(async () => {
    setConnecting(true);
    connectingRef.current = true;
    setError("");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (connectingRef.current && activeRef.current) {
        connectingRef.current = false;
        setError("Couldn't connect. Check your microphone and try again.");
        setConnecting(false);
        cleanup(); // keep voice mode ON so the error bar (with Turn off) stays visible
      }
    }, 12000);
    try {
      const r = await fetch(`/api/nxn/voice/session?agentSlug=${encodeURIComponent(agentSlug)}`, { method: "POST" });
      const data = await r.json();
      if (!data?.clientSecret || !data?.webrtcUrl) {
        throw new Error(data?.error === "voice_not_configured" ? "Voice isn't configured." : "Could not start voice.");
      }
      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        throw new Error("Microphone access is needed. Allow it and try again.");
      }
      if (!activeRef.current) { mic.getTracks().forEach((t) => t.stop()); return; }
      micRef.current = mic;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch { /* ignore */ } };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(data.webrtcUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.clientSecret}`, "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!sdpRes.ok) throw new Error("Voice handshake failed.");
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

      connectingRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      setConnecting(false);
      setMicEnabled(!streamingRef.current && !speakingRef.current);
    } catch (e) {
      connectingRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      setConnecting(false);
      setError(e instanceof Error ? e.message : "Voice unavailable.");
      cleanup(); // keep voice mode ON so the error is shown; user taps Turn off
    }
  }, [agentSlug, onEvent, cleanup, setMicEnabled]);

  const speak = useCallback((text: string) => {
    const clean = forSpeech(text);
    if (!clean) return;
    speakingRef.current = true;
    setSpeaking(true);
    setMicEnabled(false);
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = locale === "ar" ? "ar-SA" : "en-US";
    u.rate = 1.03;
    const done = () => {
      speakingRef.current = false;
      setSpeaking(false);
      if (activeRef.current && !streamingRef.current) setMicEnabled(true);
    };
    u.onend = done;
    u.onerror = done;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch { done(); }
  }, [locale, setMicEnabled]);

  const toggle = useCallback(() => {
    if (!supported) return;
    const next = !activeRef.current;
    activeRef.current = next;
    setActive(next);
    if (next) {
      spokenRef.current = messages.length - 1; // don't replay history
      void connect();
    } else {
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      speakingRef.current = false;
      setSpeaking(false);
      setError("");
      cleanup();
    }
  }, [supported, messages.length, connect, cleanup]);

  // Mute the mic while the agent responds; speak each new reply.
  useEffect(() => {
    if (!active) return;
    if (streaming) { setMicEnabled(false); return; }
    const idx = messages.length - 1;
    const last = messages[idx];
    if (last && last.role === "assistant" && last.content.trim() && idx > spokenRef.current) {
      spokenRef.current = idx;
      speak(last.content); // mutes mic, speaks, re-enables after
    } else if (!speakingRef.current && micRef.current) {
      setMicEnabled(true);
    }
  }, [active, streaming, messages, speak, setMicEnabled]);

  useEffect(() => () => {
    activeRef.current = false;
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    cleanup();
  }, [cleanup]);

  return { supported, active, connecting, listening, speaking, error, toggle };
}
