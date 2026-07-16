"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@dialog/config";

/**
 * Voice mode as an I/O layer over the normal text chat (NOT a separate realtime
 * agent): the assistant's typed replies are spoken aloud (SpeechSynthesis), and
 * the customer's speech is transcribed (SpeechRecognition) and sent as a normal
 * chat message — so the same agent, with all its tools/journeys/case panel,
 * handles it. Mic is paused while the assistant speaks (no echo/feedback), and
 * resumes after. Uses the browser's built-in speech APIs; no server, no popup.
 */
interface Msg { role: string; content: string }

// Strip markdown + in-chat fenced blocks (cards/toggles/summary/map) so the
// spoken version reads as natural prose.
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
  locale: Locale;
  messages: Msg[];
  streaming: boolean;
  send: (text: string) => void;
}) {
  const { locale, messages, streaming, send } = opts;
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const activeRef = useRef(false);
  const streamingRef = useRef(false);
  const speakingRef = useRef(false);
  const recRef = useRef<any>(null);
  const spokenRef = useRef(-1);
  streamingRef.current = streaming;

  const supported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) &&
    "speechSynthesis" in window;

  const stopListening = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) { try { rec.onend = null; rec.onresult = null; rec.stop(); } catch { /* ignore */ } }
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!activeRef.current || speakingRef.current || streamingRef.current || recRef.current) return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    // Fully guarded: a speech-API throw must never escape (it would otherwise
    // discard the batched state update that turned voice mode on).
    try {
      const rec = new SR();
      rec.lang = locale === "ar" ? "ar-SA" : "en-US";
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let got = false;
      rec.onresult = (e: any) => {
        const t = e?.results?.[0]?.[0]?.transcript?.trim();
        if (t) { got = true; send(t); }
      };
      rec.onerror = () => { /* onend follows */ };
      rec.onend = () => {
        recRef.current = null;
        setListening(false);
        // Nothing captured (silence / no-match) and still idle → keep the mic open.
        if (!got && activeRef.current && !speakingRef.current && !streamingRef.current) startListening();
      };
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setListening(false);
    }
  }, [locale, send]);

  const speak = useCallback((text: string) => {
    const clean = forSpeech(text);
    if (!clean) { startListening(); return; }
    stopListening();
    speakingRef.current = true;
    setSpeaking(true);
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = locale === "ar" ? "ar-SA" : "en-US";
    u.rate = 1.03;
    const done = () => { speakingRef.current = false; setSpeaking(false); if (activeRef.current) startListening(); };
    u.onend = done;
    u.onerror = done;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch { done(); }
  }, [locale, startListening, stopListening]);

  const toggle = useCallback(() => {
    if (!supported) return;
    const next = !activeRef.current;
    activeRef.current = next;
    setActive(next);
    if (next) {
      // Don't replay history already on screen; the effect starts the mic (kept
      // out of this handler so a speech-API throw can't discard the toggle).
      spokenRef.current = messages.length - 1;
    } else {
      stopListening();
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      speakingRef.current = false;
      setSpeaking(false);
    }
  }, [supported, messages.length, startListening, stopListening]);

  // Drive the loop off streaming + new assistant messages.
  useEffect(() => {
    if (!active) return;
    if (streaming) { stopListening(); return; }
    const idx = messages.length - 1;
    const last = messages[idx];
    if (last && last.role === "assistant" && last.content.trim() && idx > spokenRef.current) {
      spokenRef.current = idx;
      speak(last.content); // resumes listening when done
    } else if (!speakingRef.current) {
      startListening();
    }
  }, [active, streaming, messages, speak, startListening, stopListening]);

  // Stop everything on unmount.
  useEffect(() => () => {
    activeRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }, []);

  return { supported, active, listening, speaking, toggle };
}
