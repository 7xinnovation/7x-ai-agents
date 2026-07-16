"use client";

import React from "react";
import { Microphone, MicrophoneSlash, PhoneX, Waveform } from "@phosphor-icons/react";

/**
 * Voice mode: a live spoken conversation with the NXN assistant over Azure OpenAI
 * Realtime (GPT Realtime), using WebRTC directly from the browser. The server
 * mints a short-lived ephemeral key (/api/nxn/voice/session) so the real key is
 * never exposed here. Mic audio goes up over the peer connection, the assistant's
 * audio comes back on a remote track, and a data channel carries transcript
 * events for the on-screen captions. Conversational only — actual transactions
 * are handed to the text chat.
 */
type Phase = "connecting" | "live" | "error";
interface Line { role: "user" | "assistant"; text: string }

export function VoiceMode({ agentSlug, onClose }: { agentSlug: string; onClose: () => void }) {
  const [phase, setPhase] = React.useState<Phase>("connecting");
  const [error, setError] = React.useState("");
  const [muted, setMuted] = React.useState(false);
  const [speaking, setSpeaking] = React.useState(false);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [attempt, setAttempt] = React.useState(0);
  const phaseRef = React.useRef<Phase>("connecting");
  phaseRef.current = phase;

  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const micRef = React.useRef<MediaStream | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const dcRef = React.useRef<RTCDataChannel | null>(null);
  const asstBuf = React.useRef("");

  const cleanup = React.useCallback(() => {
    try { dcRef.current?.close(); } catch { /* ignore */ }
    try { pcRef.current?.close(); } catch { /* ignore */ }
    micRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current = null; micRef.current = null; dcRef.current = null;
  }, []);

  const end = React.useCallback(() => { cleanup(); onClose(); }, [cleanup, onClose]);

  const pushAssistant = (text: string) => {
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant") { const n = prev.slice(); n[n.length - 1] = { role: "assistant", text }; return n; }
      return [...prev, { role: "assistant", text }];
    });
  };

  const onEvent = React.useCallback((ev: any) => {
    switch (ev?.type) {
      case "response.audio_transcript.delta":
        asstBuf.current += ev.delta ?? "";
        setSpeaking(true);
        pushAssistant(asstBuf.current);
        break;
      case "response.audio_transcript.done":
        if (ev.transcript) pushAssistant(ev.transcript);
        break;
      case "response.done":
        setSpeaking(false);
        asstBuf.current = "";
        break;
      case "input_audio_buffer.speech_started":
        setSpeaking(false); // customer interrupts
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (ev.transcript?.trim()) setLines((prev) => [...prev, { role: "user", text: ev.transcript.trim() }]);
        break;
    }
  }, []);

  React.useEffect(() => {
    let alive = true;
    setPhase("connecting");
    setError("");
    asstBuf.current = "";
    // If we never reach a live connection, surface an error instead of hanging.
    const timeout = setTimeout(() => {
      if (alive && phaseRef.current === "connecting") {
        setError("Couldn't connect. Check your connection and microphone, then try again.");
        setPhase("error");
      }
    }, 15000);
    (async () => {
      try {
        const r = await fetch(`/api/nxn/voice/session?agentSlug=${encodeURIComponent(agentSlug)}`, { method: "POST" });
        const data = await r.json();
        if (!data?.clientSecret || !data?.webrtcUrl) throw new Error(data?.error === "voice_not_configured" ? "Voice isn't configured." : "Could not start a voice session.");

        let mic: MediaStream;
        try {
          mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch {
          throw new Error("Microphone access is needed for voice. Allow it and try again.");
        }
        if (!alive) { mic.getTracks().forEach((t) => t.stop()); return; }
        micRef.current = mic;

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.ontrack = (e) => { if (audioRef.current) audioRef.current.srcObject = e.streams[0]!; };
        pc.oniceconnectionstatechange = () => {
          if (["connected", "completed"].includes(pc.iceConnectionState)) setPhase("live");
          if (["failed"].includes(pc.iceConnectionState) && alive) { setError("Connection lost."); setPhase("error"); }
        };
        mic.getTracks().forEach((t) => pc.addTrack(t, mic));

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch { /* ignore */ } };
        dc.onopen = () => { try { dc.send(JSON.stringify({ type: "response.create" })); } catch { /* ignore */ } };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch(data.webrtcUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${data.clientSecret}`, "Content-Type": "application/sdp" },
          body: offer.sdp,
        });
        if (!sdpRes.ok) throw new Error("Voice handshake failed.");
        await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
      } catch (e) {
        if (alive) { setError(e instanceof Error ? e.message : "Voice unavailable."); setPhase("error"); }
      }
    })();
    return () => { alive = false; clearTimeout(timeout); cleanup(); };
  }, [agentSlug, attempt, cleanup, onEvent]);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    micRef.current?.getAudioTracks().forEach((t) => { t.enabled = !m; });
  };

  const retry = () => { cleanup(); setMuted(false); setAttempt((a) => a + 1); };

  return (
    <div className="dlg-voice" role="dialog" aria-label="Voice assistant">
      <audio ref={audioRef} autoPlay />
      <div className="dlg-voice-card">
        <div className={`dlg-voice-orb${speaking ? " is-speaking" : ""}${phase === "live" && !speaking ? " is-listening" : ""}`}>
          <Waveform size={30} weight="fill" />
        </div>
        <div className="dlg-voice-state">
          {phase === "connecting" && "Connecting…"}
          {phase === "live" && (speaking ? "NXN is speaking" : muted ? "Muted" : "Listening…")}
          {phase === "error" && "Voice unavailable"}
        </div>
        {phase === "error" ? (
          <div className="dlg-voice-err">
            <span>{error}</span>
            <button type="button" className="dlg-voice-retry" onClick={retry}>Try again</button>
          </div>
        ) : null}
        {lines.length > 0 ? (
          <div className="dlg-voice-transcript">
            {lines.slice(-4).map((m, i) => (
              <div key={i} className={`dlg-voice-line ${m.role}`}>{m.text}</div>
            ))}
          </div>
        ) : phase === "live" ? (
          <div className="dlg-voice-hint">Say hello, or ask about renting, renewing, or tracking.</div>
        ) : null}
        <div className="dlg-voice-controls">
          <button
            type="button"
            className={`dlg-voice-btn${muted ? " is-off" : ""}`}
            onClick={toggleMute}
            disabled={phase !== "live"}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          >
            {muted ? <MicrophoneSlash size={20} weight="fill" /> : <Microphone size={20} weight="fill" />}
          </button>
          <button type="button" className="dlg-voice-btn is-end" onClick={end} aria-label="End voice">
            <PhoneX size={20} weight="fill" />
          </button>
        </div>
      </div>
    </div>
  );
}
