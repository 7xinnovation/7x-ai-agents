"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@dialog/config";
import { nativeVoiceAllowed, nativeVoiceMode, askNativeForMic } from "./nativeBridge";

/**
 * Voice mode as an I/O layer over the normal text chat (not a separate agent):
 *  - STT: the browser's SpeechRecognition is used only as a fallback transcript
 *    and a barge-in detector. Each utterance is recorded with MediaRecorder,
 *    ended by a microphone meter (see startMeter) and sent to
 *    /api/nxn/voice/transcribe (gpt-4o-transcribe) for an ACCURATE transcript;
 *    the text is then sent as a normal chat message, so the same agent (tools,
 *    journeys, case panel) handles it.
 *  - TTS: the reply is spoken SENTENCE BY SENTENCE AS IT STREAMS, each sentence
 *    fetched from /api/nxn/voice/speak (Azure Speech, or the realtime voice as
 *    its fallback) and scheduled back to back on one audio timeline, so the
 *    first words are heard while the agent is still writing the rest. The
 *    device's own SpeechSynthesis is the fallback if the route is unavailable.
 *    While the agent is away at Emirates Post's systems and has not yet written
 *    a word, the page's tool status ("Checking pricing…") is spoken once, so
 *    the wait is acknowledged rather than silent.
 *  - Barge-in: while the assistant speaks, the recogniser listens for the
 *    CUSTOMER — words that are not the assistant's own coming back through the
 *    microphone, nor a mishearing of them — and only then, twice in a row,
 *    stops the voice and hands the turn over. See heardTheCustomer. A tap on
 *    the voice bar interrupts too, and on phones it is the only way.
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
 * THE REPLY, ONE SENTENCE AT A TIME, WHILE IT IS STILL BEING WRITTEN.
 *
 * Reported 2 November: the voice did not feel natural. Part of that was the
 * silence: nothing was spoken until the agent had finished the whole reply —
 * eight to sixteen seconds of tool rounds and writing — and then the voice
 * engine's own start-up was added on top before the first word.
 *
 * So the reply is cut into speakable units as it streams, and each unit is
 * spoken as soon as it is complete. A unit ends at a sentence end followed by
 * whitespace (so "AED 695.00" and "www.emiratespost.ae" do not split), at a
 * blank line, or at a fenced block — which is a card, silent, and a boundary.
 * An OPEN fence is a card still being written and is held back entirely, so
 * its internals are never voiced. A unit with no letters in it yet ("1.", the
 * number of a list item) waits for the words that follow it.
 *
 * Returns the units ready to speak, already made speakable (forSpeech), and
 * how many characters of `raw` they consumed; the caller passes the rest next
 * time. With `final`, whatever remains is a unit too.
 */
export function speechUnits(raw: string, final: boolean, locale: "en" | "ar" = "en"): { units: string[]; consumed: number } {
  const units: string[] = [];
  const letters = (s: string) => /\p{L}/u.test(s);
  // An open fence: hold back from where it opens.
  let safeEnd = raw.length;
  {
    let count = 0;
    let last = -1;
    let at = raw.indexOf("```");
    while (at !== -1) { count++; last = at; at = raw.indexOf("```", at + 3); }
    if (count % 2 === 1) safeEnd = last;
  }
  let buf = "";
  let consumed = 0;
  const flush = (upTo: number) => {
    const clean = forSpeech(buf, locale);
    if (clean && letters(clean)) units.push(clean);
    buf = "";
    consumed = upTo;
  };
  let i = 0;
  while (i < safeEnd) {
    if (raw.startsWith("```", i)) {
      // A closed fenced block (it is before safeEnd): a card, a boundary.
      const end = raw.indexOf("```", i + 3) + 3;
      if (letters(buf)) flush(i); else buf = "";
      i = end;
      consumed = end;
      continue;
    }
    const ch = raw[i] as string;
    buf += ch;
    i++;
    if (/[.!?؟۔]/.test(ch)) {
      const next = raw[i];
      const boundary = next === undefined ? final && safeEnd === raw.length : /\s/.test(next);
      if (boundary && letters(buf)) flush(i);
    } else if (ch === "\n" && raw[i] === "\n") {
      if (letters(buf)) flush(i);
    }
  }
  if (final) {
    if (letters(buf)) flush(safeEnd);
    consumed = raw.length;
  }
  return { units, consumed };
}

/**
 * BARGE-IN IS A QUESTION OF WORDS, NOT VOLUME — AND NOT OF MISHEARD WORDS.
 *
 * Reported 12 October: "it replies with 2 words and then disconnects and goes
 * back to listening." The interrupt detector was an energy meter on the
 * microphone — any sustained sound above a floor, a third of a second long, was
 * taken for the customer. The assistant's own voice coming out of the speakers
 * is a sustained sound above that floor. Volume cannot tell the customer from
 * the assistant. Words can: the recogniser runs while the voice speaks, and
 * what it hears is compared with what is being said. The assistant's own voice
 * comes back as its own words; the customer brings words of their own. Numbers
 * are left out of the comparison, because the voice says "six hundred
 * ninety-five dirhams" where the text says "AED 695", and so are the little
 * words every sentence shares.
 *
 * Reported 2 November: it still stopped midway. The recogniser is an English
 * one, and the reply is full of names it has never heard — Mansoori comes back
 * as "man surrey", Fujairah as "fuji ira", and two such mishearings in one
 * result were two "new" words, which was the customer, which stopped the voice.
 * So a heard word is also compared by its CONSONANTS with the words being
 * spoken: "mn" and "fj" are in "Mansoori" and "Fujairah", and a word whose
 * skeleton is in a word being said is the voice itself, misheard. Only
 * Latin-script words are tested this way; Arabic is compared whole.
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

/** A Latin word reduced to its consonants: what survives a recogniser's mishearing. */
export function consonants(w: string): string {
  return w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "").replace(/[aeiouyhw]/g, "");
}

/**
 * Is this heard word one of the spoken words, misheard? True when its consonant
 * skeleton sits inside a spoken word's (or, for a longer one, contains it).
 * Too few consonants to tell is not evidence of a customer either.
 */
export function isEcho(word: string, spokenSkeletons: string[]): boolean {
  if (!/[a-z]/i.test(word)) return false;
  const k = consonants(word);
  if (k.length < 2) return true;
  return spokenSkeletons.some((s) => s.includes(k) || (k.length >= 3 && s.length >= 3 && k.includes(s)));
}

/**
 * Did the microphone hear the CUSTOMER, or the assistant's own voice coming back?
 *
 * True when what was heard carries at least two content words that are neither
 * in what the assistant is saying nor a mishearing of it, and those are at
 * least half of its content words. Short fragments and anything that is mostly
 * the spoken text are the voice itself, and are ignored.
 */
export function heardTheCustomer(heard: string, spoken: string): boolean {
  const said = bagOfWords(spoken);
  const skeletons = [...said].map(consonants).filter((s) => s.length >= 2);
  const words = [...bagOfWords(heard)].filter((w) => w.length >= 3 && !/^\p{N}+$/u.test(w) && !SHARED_WORDS.has(w));
  if (words.length < 2) return false;
  const novel = words.filter((w) => !said.has(w) && !isEcho(w, skeletons));
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

/**
 * How many times in a row the detector must hear the customer before the voice
 * stops. A mishearing is a moment; a person interrupting keeps talking, and the
 * recogniser reports them again a few hundred milliseconds later.
 */
const BARGE_CONFIRMATIONS = 2;

/**
 * HOW LONG A PAUSE IS ALLOWED TO BE, and the three limits around it.
 *
 * Two seconds is what Emirates Post asked for: "once silence for 2 seconds or
 * more, we can interrupt and process". It is also about right — long enough to
 * think of a box number, short enough that the reply does not feel late.
 */
const SILENCE_MS = 2000;
/** Nothing heard at all: close the turn and open a fresh one rather than hang. */
const NO_SPEECH_MS = 15000;
/** A ceiling, so a meter that never sees silence cannot record for ever. */
const MAX_UTTERANCE_MS = 60000;
/** How often the microphone level is read. */
const METER_TICK_MS = 50;
/**
 * The level a voice has to clear, as RMS of the waveform (0 to 1).
 *
 * Absolute, and only ever raised by the room — never lowered to it. A bar
 * derived from what has been heard is wrong exactly when it matters: a customer
 * who starts talking the moment the microphone opens would set the bar at their
 * own voice and never cross it.
 *
 * Lowered on 2 November from 0.015: a soft speaker on a phone held at arm's
 * length sat under the old bar and was only ever heard when the turn gave up
 * at fifteen seconds. The room still raises the bar — speech must be two and a
 * half times the quietest thing heard — and a sound has to LAST to count (see
 * SPEECH_SUSTAIN_TICKS), so a lower bar does not make a keyboard a customer.
 */
const SPEECH_RMS = 0.008;
const SPEECH_OVER_FLOOR = 2.5;
/** Consecutive loud readings before the customer is taken to have spoken: 150 ms. */
const SPEECH_SUSTAIN_TICKS = 3;
const NOISE_FLOOR_MIN = 0.0008;
/** However loud the room is, the bar stops here — well under a speaking voice. */
const NOISE_FLOOR_MAX = 0.02;

/**
 * What the meter knows between one reading and the next.
 *
 * Pulled out of the hook and exported so the rule Emirates Post asked for can
 * be TESTED rather than trusted: see scripts/test-voice-endpointing-2026-10-28.
 * A microphone is not available to a test, and a 50 ms interval that decides
 * when to cut a customer off is not something to verify by talking at a laptop
 * and hoping.
 */
export interface MeterState {
  startedAt: number;
  lastLoudAt: number;
  floor: number;
  spoke: boolean;
  /** Consecutive loud readings so far. */
  loudRun: number;
}

export function newMeterState(now: number): MeterState {
  return { startedAt: now, lastLoudAt: 0, floor: NOISE_FLOOR_MAX, spoke: false, loudRun: 0 };
}

/** Why a turn ended, or null while it is still the customer's. */
export type MeterEnd = "silence" | "no-speech" | "too-long" | null;

/** One reading of the microphone level, folded into the state. */
export function meterStep(state: MeterState, rms: number, now: number): { state: MeterState; end: MeterEnd } {
  const floor = Math.min(state.floor, Math.max(rms, NOISE_FLOOR_MIN));
  const loud = rms > Math.max(SPEECH_RMS, floor * SPEECH_OVER_FLOOR);
  const loudRun = loud ? state.loudRun + 1 : 0;
  const next: MeterState = {
    startedAt: state.startedAt,
    floor,
    spoke: state.spoke || loudRun >= SPEECH_SUSTAIN_TICKS,
    lastLoudAt: loud ? now : state.lastLoudAt,
    loudRun,
  };
  const elapsed = now - next.startedAt;
  // The order matters: a customer who is mid-pause at the ceiling has still
  // said something, and what they said should be sent rather than discarded.
  if (next.spoke && next.lastLoudAt && now - next.lastLoudAt >= SILENCE_MS) return { state: next, end: "silence" };
  if (!next.spoke && elapsed >= NO_SPEECH_MS) return { state: next, end: "no-speech" };
  if (elapsed >= MAX_UTTERANCE_MS) return { state: next, end: "too-long" };
  return { state: next, end: null };
}

function pickMime(): string {
  const MR = typeof window !== "undefined" ? (window as any).MediaRecorder : undefined;
  if (!MR?.isTypeSupported) return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MR.isTypeSupported(m)) return m;
  }
  return "";
}

/**
 * WHAT A REFUSED MICROPHONE IS TOLD TO THE CUSTOMER.
 *
 * Their mobile developer asked whether a denial should carry a reason, and it
 * should: these are three different situations and only one of them is worth
 * trying again in the same breath. "blocked" is the one that matters — the OS
 * will not ask again, so a customer told to "allow it and try again" is being
 * sent to a dialog that will never appear.
 */
export function micRefusal(reason: "denied" | "blocked" | "unavailable", locale: Locale): string {
  if (locale === "ar") {
    if (reason === "blocked") return "الوصول إلى الميكروفون موقوف لهذا التطبيق. يمكن تفعيله من إعدادات الجهاز.";
    if (reason === "unavailable") return "لا يتوفر ميكروفون على هذا الجهاز.";
    return "نحتاج إذن الميكروفون. يرجى السماح به والمحاولة مرة أخرى.";
  }
  if (reason === "blocked") return "Microphone access is turned off for this app. You can turn it on in your device settings.";
  if (reason === "unavailable") return "There is no microphone available on this device.";
  return "Microphone access is needed. Allow it and try again.";
}

/**
 * MAY THIS HOST SHOW THE MICROPHONE BUTTON?
 *
 * WHY SpeechRecognition IS NOT ON THE LIST.
 *
 * The Emirates Post app runs this widget in a WebView, and a WebView is not the
 * browser the Web Speech API lives in: an Android WebView exposes no
 * `webkitSpeechRecognition` at all, and a WKWebView exposes the constructor but
 * never raises the permission prompt behind it, so recognition quietly returns
 * nothing. Requiring it hid the microphone button on the one host Emirates
 * Post's customers actually use.
 *
 * It was never doing the real work. The turn is ended by the meter reading the
 * microphone (see startMeter) and the words come from
 * /api/nxn/voice/transcribe; on-device recognition is a transcript of last
 * resort and a barge-in detector, and both degrade on their own — a missing
 * recogniser leaves the tap on the voice bar as the way to interrupt.
 *
 * So the button needs a microphone, a recorder, and SOMETHING that can turn
 * what it captures into words: the device's recogniser, or our server plus an
 * AudioContext to drive the meter that ends the turn. A mic that records and
 * sends nothing is worse than no button, so neither half may be assumed.
 */
export function micUsable(host: {
  recognition: boolean;
  recorder: boolean;
  microphone: boolean;
  nativeAllowed: boolean;
  audioContext: boolean;
  synthesis: boolean;
  serverStt: boolean;
}): boolean {
  if (!host.recorder || !host.microphone || !host.nativeAllowed) return false;
  // Something has to hear it, and something has to say the reply back.
  const heard = host.recognition || (host.serverStt && host.audioContext);
  const spoken = host.audioContext || host.synthesis;
  return heard && spoken;
}

/** What the voice knows about the reply it is in the middle of. */
interface Segmenting {
  /** Which message. */
  idx: number;
  /** How much of its text has been cut into units already. */
  consumed: number;
  /** The tool status has been spoken for this reply. */
  acked: boolean;
  /** The customer interrupted: the rest of this reply is not spoken. */
  muted: boolean;
}

export function useVoiceChat(opts: {
  agentSlug: string;
  locale: Locale;
  messages: Msg[];
  streaming: boolean;
  send: (text: string) => void;
  /**
   * The server can turn recorded audio into words — AZURE_REALTIME_* is set, so
   * /api/nxn/voice/transcribe answers. It is what makes voice possible on a host
   * with no SpeechRecognition of its own; see `supported`.
   */
  serverStt?: boolean;
  /**
   * What the page is showing while the agent is away at a tool ("Checking
   * pricing…"), or null. Spoken once per reply, before any of the reply has
   * been written, so a long lookup is acknowledged rather than silent.
   */
  toolStatus?: string | null;
}) {
  const { locale, messages, streaming, send, serverStt = false, toolStatus = null } = opts;
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  /** The host's last refusal, when it gave one. */
  const [hostRefusal, setHostRefusal] = useState<"denied" | "blocked" | "unavailable" | null>(null);

  const activeRef = useRef(false);
  const streamingRef = useRef(false);
  const speakingRef = useRef(false);
  streamingRef.current = streaming;
  const localeRef = useRef<Locale>(locale);
  localeRef.current = locale;
  // The parent hands a fresh `send` closure every render; hold it in a ref so the
  // callback graph (listenOnce, the watchdog interval) stays stable instead of
  // being rebuilt and re-armed on every render.
  const sendRef = useRef(send);
  sendRef.current = send;
  const micRef = useRef<MediaStream | null>(null);
  const recRef = useRef<any>(null); // SpeechRecognition, capturing an utterance
  const busyRef = useRef(false); // an utterance is being recognized/transcribed
  const spokenRef = useRef(-1);
  const audioCtxRef = useRef<AudioContext | null>(null); // playback of the voice
  const gainRef = useRef<GainNode | null>(null); // one output node for the context's life
  const ttsAbortRef = useRef<AbortController | null>(null); // in-flight /speak stream
  const ttsSourcesRef = useRef<AudioBufferSourceNode[]>([]); // scheduled audio nodes
  // The sentence queue: what is waiting to be fetched, whether the pump is
  // draining it, where on the audio timeline the next sound starts, and whether
  // the reply being spoken has been cut into units to its end.
  const queueRef = useRef<string[]>([]);
  const pumpingRef = useRef(false);
  const cursorRef = useRef(0);
  const flushedRef = useRef(true);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const segRef = useRef<Segmenting>({ idx: -1, consumed: 0, acked: false, muted: false });
  // Barge-in: a second recogniser that runs only while the assistant speaks, the
  // text being spoken, which is what its hearing is compared against, and how
  // many times in a row it has heard the customer.
  const bargeRecRef = useRef<any>(null);
  const spokenTextRef = useRef("");
  const bargeHitsRef = useRef(0);
  const warnedRef = useRef(false);
  // The microphone meter that decides when the customer has finished speaking,
  // and the one source node the analyser hangs off.
  const meterStopRef = useRef<(() => void) | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  /** Abandons the utterance being captured, without sending it. */
  const cancelUtteranceRef = useRef<(() => void) | null>(null);

  const supported =
    typeof window !== "undefined" &&
    // "unavailable" from the host is final for this session: there is no
    // microphone to grant, so the button has nothing to open.
    hostRefusal !== "unavailable" &&
    micUsable({
      recognition: "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
      recorder: "MediaRecorder" in window,
      microphone: !!navigator.mediaDevices?.getUserMedia,
      // A WebView reports a microphone it may not be permitted to open; asking
      // for one the app has no usage description for kills the app. See
      // nativeVoiceAllowed.
      nativeAllowed: nativeVoiceAllowed(),
      audioContext: "AudioContext" in window || "webkitAudioContext" in window,
      synthesis: "speechSynthesis" in window,
      serverStt,
    });

  /**
   * THE AUDIO CONTEXT, OPENED AT 24 kHz AND KEPT RUNNING.
   *
   * 24 kHz because that is the rate the voice arrives at: a context at the
   * device's own 48 kHz would resample each small chunk on its own and the
   * chunk boundaries would sit under the speech as a periodic tone (Emirates
   * Post, 13 September). Kept running because iOS does not: a phone call, Siri,
   * a notification sound or the microphone opening puts the context into an
   * "interrupted" state Safari invented, in which every scheduled buffer is
   * silently never played — the reply "stops midway" and the mic opens on the
   * silence. So the context's own state change asks for it back, and so does
   * the page coming back into view.
   */
  const audioContext = useCallback((): AudioContext | null => {
    const AC: typeof AudioContext | undefined =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    let ctx = audioCtxRef.current;
    if (!ctx) {
      try { ctx = new AC({ sampleRate: 24000 }); }
      catch { try { ctx = new AC(); } catch { return null; } }
      audioCtxRef.current = ctx;
      const c = ctx;
      c.onstatechange = () => {
        if (!activeRef.current) return;
        const s = c.state as string;
        if (s !== "running" && s !== "closed") c.resume().catch(() => { /* not ours to resume yet */ });
      };
    }
    if ((ctx.state as string) !== "running") { try { void ctx.resume(); } catch { /* ignore */ } }
    return ctx;
  }, []);

  const stopRecognition = useCallback(() => {
    // Whatever is being captured is abandoned first: the meter, the recorder
    // and the recogniser belong to one utterance and stop together.
    cancelUtteranceRef.current?.();
    const rec = recRef.current;
    recRef.current = null;
    busyRef.current = false;
    if (rec) { try { rec.onend = null; rec.onresult = null; rec.abort(); } catch { /* ignore */ } }
    setListening(false);
  }, []);

  /**
   * THE METER THAT ENDS THE TURN.
   *
   * Reported 28 October: "the voice command seems to be limited to around 5
   * seconds, I cannot complete my sentence if it is more than that."
   *
   * It was not a limit anyone set. The turn ended when the browser's
   * SpeechRecognition said it had — `continuous = false` means the recogniser
   * stops at the first endpoint ITS OWN model finds, which is tuned for short
   * commands and treats the pause in the middle of a sentence as the end of
   * one. The Web Speech API exposes no way to lengthen that: there is no
   * silence threshold, no timeout, no setting of any kind. Asking the
   * recogniser more politely was never going to work.
   *
   * So the endpoint is measured here instead, off the microphone itself: an
   * analyser on the same stream the recorder is using, read every 50 ms, and
   * the turn ends after {@link SILENCE_MS} of quiet ONCE THE CUSTOMER HAS
   * ACTUALLY SPOKEN. Pause to think for a second and a half and the turn is
   * still yours; stop for two and it is sent.
   *
   * The threshold is absolute with the room's own noise allowed to raise it,
   * not the other way round. A floor derived purely from what has been heard
   * is wrong exactly when it matters — a customer who starts talking the
   * instant the mic opens would calibrate the floor to their own voice and
   * never cross it.
   *
   * EVERY FAILURE HERE LOSES TIME, NOT WORDS. If the meter never hears speech
   * the turn still closes at {@link NO_SPEECH_MS} and whatever was recorded is
   * still transcribed and sent; if the meter cannot be built at all the old
   * recogniser-driven endpointing is used unchanged. The recording is what
   * gets transcribed either way — the meter only decides when to stop it.
   */
  const startMeter = useCallback((onEnd: (end: Exclude<MeterEnd, null>) => void): boolean => {
    const stream = micRef.current;
    if (!stream) return false;
    const ctx = audioContext();
    if (!ctx) return false;

    let analyser: AnalyserNode;
    try {
      // One source node per microphone, not per utterance: a stream may only be
      // tapped so many times before the browser stops handing them out.
      if (!micSourceRef.current) micSourceRef.current = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      // Deliberately NOT connected onward to the destination. This is a
      // measurement, and routing the microphone to the speakers would be
      // feedback.
      micSourceRef.current.connect(analyser);
    } catch { return false; }

    const data = new Uint8Array(analyser.fftSize);
    let state = newMeterState(Date.now());
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      try { micSourceRef.current?.disconnect(analyser); } catch { /* already gone */ }
      if (meterStopRef.current === stop) meterStopRef.current = null;
    };

    timer = setInterval(() => {
      try { analyser.getByteTimeDomainData(data); } catch { return; }
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = ((data[i] ?? 128) - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      const r = meterStep(state, rms, Date.now());
      state = r.state;
      if (r.end) { stop(); onEnd(r.end); }
    }, METER_TICK_MS);

    meterStopRef.current = stop;
    return true;
  }, [audioContext]);

  // One utterance: record it while the recogniser transcribes alongside (as a
  // fallback), and end it when the meter above hears the customer stop.
  const listenOnce = useCallback(() => {
    if (!activeRef.current || speakingRef.current || streamingRef.current || busyRef.current || !micRef.current) return;
    // May be undefined — a host without a recogniser still records, still has
    // its turn ended by the meter, and is still transcribed by the server.
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    busyRef.current = true;
    let fallback = "";
    /**
     * The last interim guess, kept only for the case where the recording could
     * not be transcribed AND the recogniser never promoted anything to final —
     * which a continuous recognition that is aborted mid-sentence can do, and
     * the old one-shot could not. Better a rough sentence than silence.
     */
    let interim = "";
    let finished = false;
    let recorder: any = null;
    const chunks: BlobPart[] = [];
    const mime = pickMime();
    try {
      recorder = new (window as any).MediaRecorder(micRef.current, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (e: any) => { if (e.data?.size) chunks.push(e.data); };
      recorder.start();
    } catch { recorder = null; }

    /** Everything this utterance owns, stopped without sending anything. */
    const abandon = () => {
      if (finished) return;
      finished = true;
      meterStopRef.current?.();
      cancelUtteranceRef.current = null;
      if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch { /* ignore */ } }
    };
    cancelUtteranceRef.current = abandon;

    /**
     * A RECORDING NOBODY SPOKE IN IS NOT SENT.
     *
     * Found 2 November, verifying production: one second of pure silence,
     * transcribed, came back as "How can I get a PO Box?". The transcriber is
     * given the domain as a hint and, handed nothing to hear, hears the hint.
     * Until now a turn the meter closed for no-speech was still transcribed
     * ("loses time, not words") — and so a customer who sat quietly for fifteen
     * seconds had a question they never asked answered at length. When the
     * meter heard no speech AND the device recogniser heard no words either,
     * there is nothing to send; the microphone simply opens again.
     */
    const finish = async (end: MeterEnd | "recogniser" = "recogniser") => {
      if (finished) return;
      finished = true;
      meterStopRef.current?.();
      cancelUtteranceRef.current = null;
      const rec = recRef.current;
      recRef.current = null;
      if (rec) { try { rec.onend = null; rec.onresult = null; rec.abort(); } catch { /* ignore */ } }
      setListening(false);
      let blob: Blob | null = null;
      if (recorder && recorder.state !== "inactive") {
        blob = await new Promise<Blob>((res) => { recorder.onstop = () => res(new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" })); try { recorder.stop(); } catch { res(new Blob(chunks)); } });
      }
      const heardNothing = end === "no-speech" && !fallback.trim() && !interim.trim();
      if (heardNothing) {
        busyRef.current = false;
        if (activeRef.current && !speakingRef.current && !streamingRef.current) listenOnce();
        return;
      }
      let text = "";
      if (blob && blob.size > 1400) {
        try {
          const r = await fetch("/api/nxn/voice/transcribe", { method: "POST", headers: { "Content-Type": blob.type || "audio/webm" }, body: blob });
          if (r.ok) text = ((await r.json())?.text ?? "").trim();
        } catch { /* fall back below */ }
      }
      // Graceful fallback to on-device recognition: what it finalised, then
      // what it had merely heard.
      if (!text) text = fallback || interim;
      busyRef.current = false;
      if (text) sendRef.current(text);
      // If nothing was sent, keep listening; otherwise the effect resumes after the reply.
      if (!text && activeRef.current && !speakingRef.current && !streamingRef.current) listenOnce();
    };

    const metered = startMeter((end) => { void finish(end); });

    /**
     * The recogniser, re-armed as often as the browser drops it.
     *
     * With the meter in charge it is no longer the clock, only a transcript of
     * last resort, so it runs `continuous` and is simply started again when
     * Chromium ends it of its own accord — which it does after every silence,
     * and which is precisely the behaviour that used to end the customer's
     * sentence for them. Without a meter it keeps its old job: one shot, and
     * its ending ends the turn.
     */
    const arm = () => {
      if (!SR || finished || !activeRef.current) return;
      let rec: any;
      try { rec = new SR(); } catch { return; }
      recRef.current = rec;
      rec.lang = locale === "ar" ? "ar-SA" : "en-US";
      rec.continuous = metered;
      rec.interimResults = metered;
      rec.maxAlternatives = 1;
      rec.onresult = (e: any) => {
        const results = e?.results ?? [];
        for (let i = e?.resultIndex ?? 0; i < results.length; i++) {
          const r = results[i];
          // Interim results are for the meter's benefit, not the transcript's:
          // only a final one is kept, and they are joined because a continuous
          // recognition reports a long answer as several.
          const said = String(r?.[0]?.transcript ?? "");
          if (!metered || r?.isFinal) fallback = `${fallback} ${said}`.trim();
          else if (said.trim()) interim = said.trim();
        }
      };
      rec.onerror = () => { /* onend follows */ };
      rec.onend = () => {
        if (recRef.current !== rec) return;
        recRef.current = null;
        if (finished) return;
        if (!metered) { void finish(); return; }
        // Started from a timeout rather than from inside onend: Chromium
        // refuses a start() that happens while it is still ending.
        setTimeout(arm, 120);
      };
      try { rec.start(); } catch { recRef.current = null; }
    };

    setListening(true);
    arm();
    if (!recRef.current && !metered) { busyRef.current = false; finished = true; cancelUtteranceRef.current = null; setListening(false); }
  }, [locale, startMeter]);

  /** Whatever is playing or about to: stopped. The queue is the caller's. */
  const stopPlayback = useCallback(() => {
    try { ttsAbortRef.current?.abort(); } catch { /* ignore */ }
    ttsAbortRef.current = null;
    for (const s of ttsSourcesRef.current) { try { s.stop(); } catch { /* already stopped */ } }
    ttsSourcesRef.current = [];
    if (finishTimerRef.current) { clearTimeout(finishTimerRef.current); finishTimerRef.current = null; }
  }, []);

  /** The barge-in recogniser, off. */
  const stopBargeListener = useCallback(() => {
    const rec = bargeRecRef.current;
    bargeRecRef.current = null;
    bargeHitsRef.current = 0;
    if (rec) { try { rec.onend = null; rec.onresult = null; rec.onerror = null; rec.abort(); } catch { /* ignore */ } }
  }, []);

  /**
   * The customer interrupted — by speaking over the assistant, or by tapping
   * the voice bar. Silence ourselves, forget the rest of this reply, and start
   * listening (once the agent has stopped writing, if it has not).
   */
  const interrupt = useCallback(() => {
    if (!speakingRef.current) return;
    segRef.current.muted = true;
    queueRef.current = [];
    flushedRef.current = true;
    stopBargeListener();
    stopPlayback();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    speakingRef.current = false;
    setSpeaking(false);
    spokenTextRef.current = "";
    if (activeRef.current && !streamingRef.current) listenOnce();
  }, [stopBargeListener, stopPlayback, listenOnce]);

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
      let isFinal = false;
      const results = e?.results ?? [];
      for (let i = e?.resultIndex ?? 0; i < results.length; i++) {
        heard += " " + (results[i]?.[0]?.transcript ?? "");
        if (results[i]?.isFinal) isFinal = true;
      }
      if (heardTheCustomer(heard, spokenTextRef.current)) {
        // Once could be a name misheard; a person keeps going.
        bargeHitsRef.current += 1;
        if (isFinal || bargeHitsRef.current >= BARGE_CONFIRMATIONS) interrupt();
      } else {
        bargeHitsRef.current = 0;
      }
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

  /** The reply has been said to its end: the turn is the customer's again. */
  const done = useCallback(() => {
    stopBargeListener();
    speakingRef.current = false;
    setSpeaking(false);
    ttsAbortRef.current = null;
    ttsSourcesRef.current = [];
    spokenTextRef.current = "";
    if (activeRef.current && !streamingRef.current) listenOnce();
  }, [stopBargeListener, listenOnce]);

  /**
   * Nothing left to fetch, nothing left to cut, and the last scheduled sound
   * is still playing: wait for the timeline to reach it, then hand over. Every
   * condition is checked again when the timer fires, because a silent turn
   * (a payment settling) may have started a new reply in the meantime.
   */
  const maybeFinish = useCallback(() => {
    if (finishTimerRef.current) { clearTimeout(finishTimerRef.current); finishTimerRef.current = null; }
    const idle = () => speakingRef.current && !pumpingRef.current && queueRef.current.length === 0 && flushedRef.current;
    if (!idle()) return;
    const ctx = audioCtxRef.current;
    const remaining = ctx ? Math.max(0, cursorRef.current - ctx.currentTime) : 0;
    finishTimerRef.current = setTimeout(() => {
      finishTimerRef.current = null;
      if (idle()) done();
    }, remaining * 1000 + 80);
  }, [done]);

  /**
   * One utterance, fetched from /api/nxn/voice/speak as raw PCM16 at 24 kHz and
   * scheduled on the shared timeline as it arrives, so consecutive sentences
   * play back to back. The gain node is the context's, not the utterance's:
   * disconnecting one per sentence would silence the sentence still playing
   * behind it.
   *
   * "played" when audio was scheduled; "unavailable" to fall back to the
   * device's voice; "aborted" when the customer interrupted.
   */
  const playUtterance = useCallback(async (text: string): Promise<"played" | "unavailable" | "aborted"> => {
    const ctx = audioContext();
    if (!ctx) return "unavailable";
    try { if ((ctx.state as string) !== "running") await ctx.resume(); } catch { /* ignore */ }
    if (!gainRef.current) {
      gainRef.current = ctx.createGain();
      gainRef.current.connect(ctx.destination);
    }
    const gain = gainRef.current;

    const controller = new AbortController();
    ttsAbortRef.current = controller;
    let resp: Response;
    try {
      resp = await fetch("/api/nxn/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, locale: localeRef.current === "ar" ? "ar" : "en" }),
        signal: controller.signal,
      });
    } catch { return controller.signal.aborted ? "aborted" : "unavailable"; }
    if (!resp.ok || !resp.body) {
      // Said once per session, so a silent fallback to the device voice is at
      // least visible in the console — the preview API's retirement was not.
      if (!warnedRef.current) {
        warnedRef.current = true;
        console.warn(`[voice] the natural voice is unavailable (${resp.status}); using the device's own voice`);
      }
      return "unavailable";
    }

    const reader = resp.body.getReader();
    let carry: Uint8Array | null = null;
    let played = false;
    try {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
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
        // the same rate -- which is why it is opened that way -- the buffer is
        // played sample for sample and nothing is resampled.
        const buf = ctx.createBuffer(1, n, 24000);
        const ch = buf.getChannelData(0);
        const dv = new DataView(bytes.buffer, bytes.byteOffset, usable);
        for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        // The first sound of a turn gets a small lead for jitter. An underrun —
        // the network stalling for longer than the audio in hand — used to butt
        // the next chunk straight onto the playhead, joining two unrelated
        // waveforms mid-cycle; restart with a short lead instead, so a gap
        // sounds like a gap.
        const now = ctx.currentTime;
        const startAt = cursorRef.current > now ? cursorRef.current : now + (ttsSourcesRef.current.length ? 0.03 : 0.12);
        try { src.start(startAt); } catch { /* ctx closed */ }
        ttsSourcesRef.current.push(src);
        src.onended = () => { const i = ttsSourcesRef.current.indexOf(src); if (i >= 0) ttsSourcesRef.current.splice(i, 1); };
        cursorRef.current = startAt + buf.duration;
        played = true;
      }
    } catch { /* aborted or stream error */ }
    if (controller.signal.aborted) return "aborted";
    return played ? "played" : "unavailable";
  }, [audioContext]);

  /** The device's own voice, as a fallback, one utterance at a time. */
  const speakBrowser = useCallback((text: string) => new Promise<void>((resolve) => {
    try {
      if (!("speechSynthesis" in window)) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = localeRef.current === "ar" ? "ar-SA" : "en-US";
      u.rate = 1.03;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    } catch { resolve(); }
  }), []);

  /**
   * Drains the queue, one utterance at a time, in order. Fetching the next
   * sentence begins the moment the previous one has been received, not when it
   * has finished playing, so the audio in hand is always ahead of the playhead.
   */
  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      while (activeRef.current && speakingRef.current) {
        const next = queueRef.current.shift();
        if (next === undefined) break;
        const r = await playUtterance(next);
        if (r === "aborted") break;
        if (r === "unavailable" && activeRef.current && speakingRef.current) await speakBrowser(next);
      }
    } finally {
      pumpingRef.current = false;
    }
    maybeFinish();
  }, [playUtterance, speakBrowser, maybeFinish]);

  /** One speakable unit, already cleaned, queued; the voice starts if it is not already going. */
  const enqueue = useCallback((clean: string) => {
    if (!clean || !activeRef.current) return;
    queueRef.current.push(clean);
    spokenTextRef.current = `${spokenTextRef.current} ${clean}`.trim();
    if (!speakingRef.current) {
      stopRecognition();
      speakingRef.current = true;
      setSpeaking(true);
      bargeHitsRef.current = 0;
      cursorRef.current = 0;
      startBargeListener();
    }
    void pump();
  }, [stopRecognition, startBargeListener, pump]);

  const cleanup = useCallback(() => {
    stopRecognition();
    stopBargeListener();
    stopPlayback();
    queueRef.current = [];
    flushedRef.current = true;
    try { micSourceRef.current?.disconnect(); } catch { /* already gone */ }
    micSourceRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    speakingRef.current = false;
    setSpeaking(false);
    setListening(false);
  }, [stopRecognition, stopBargeListener, stopPlayback]);

  /** The app has already put the OS dialog in front of this customer. */
  const nativeMicGranted = useRef(false);

  const toggle = useCallback(async () => {
    if (!supported) return;
    if (activeRef.current) { activeRef.current = false; setActive(false); setError(""); cleanup(); return; }
    activeRef.current = true;
    setActive(true);
    setError("");
    spokenRef.current = messages.length - 1;
    segRef.current = { idx: -1, consumed: 0, acked: false, muted: false };
    // Unlock audio output on this user gesture so streamed replies can play.
    // Opened HERE, at 24 kHz, before anything is spoken: see audioContext.
    audioContext();
    /**
     * ASKING THE APP FIRST.
     *
     * In "ask" mode the app has the usage description but has not yet put the
     * OS permission dialog in front of the customer, and wants to do it on the
     * tap rather than at launch. So the tap goes to the app, and the
     * microphone is not touched until it answers yes — a getUserMedia on a
     * maybe is the crash this whole gate exists for.
     */
    if (nativeVoiceMode() === "ask" && !nativeMicGranted.current) {
      const answer = await askNativeForMic();
      if (!activeRef.current) return;
      if (!answer.granted) {
        const why = answer.reason ?? "denied";
        setHostRefusal(why);
        setError(micRefusal(why, locale));
        return;
      }
      nativeMicGranted.current = true;
      setHostRefusal(null);
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!activeRef.current) { mic.getTracks().forEach((t) => t.stop()); return; }
      micRef.current = mic;
      // Opening the microphone is one of the things that interrupts the audio
      // context on iOS; ask for it back before the first reply needs it.
      audioContext();
      listenOnce();
    } catch {
      setError("Microphone access is needed. Allow it and try again.");
      // keep active so the error stays visible; user taps Turn off
    }
  }, [supported, messages.length, cleanup, listenOnce, locale, audioContext]);

  /**
   * THE REPLY, SPOKEN AS IT ARRIVES.
   *
   * While the agent streams, the newest assistant message is cut into units
   * (speechUnits) and each complete one is queued the moment it is complete.
   * Before any of it has been written, the tool status is spoken once, so a
   * long lookup is acknowledged. When the stream ends, whatever is left is
   * queued and the voice is told it may finish. A reply interrupted by the
   * customer stays silent to its end. The account pulse is a long visual
   * summary — voice speaks only its intro line and leaves the rest to read.
   */
  useEffect(() => {
    if (!active) return;
    const lang = locale === "ar" ? "ar" : "en";
    const idx = messages.length - 1;
    const last = messages[idx];
    const reply = !!last && last.role === "assistant" && idx > spokenRef.current;
    if (streaming) {
      stopRecognition();
      if (!reply) return;
      if (segRef.current.idx !== idx) {
        segRef.current = { idx, consumed: 0, acked: false, muted: false };
        flushedRef.current = false;
      }
      const seg = segRef.current;
      if (seg.muted || last.pulse) return;
      if (!last.content.trim()) {
        if (toolStatus && !seg.acked) {
          seg.acked = true;
          enqueue(forSpeech(toolStatus, lang));
        }
        return;
      }
      const { units, consumed } = speechUnits(last.content.slice(seg.consumed), false, lang);
      seg.consumed += consumed;
      for (const u of units) enqueue(u);
      return;
    }
    if (reply && last.content.trim()) {
      spokenRef.current = idx;
      if (segRef.current.idx !== idx) segRef.current = { idx, consumed: 0, acked: false, muted: false };
      const seg = segRef.current;
      if (!seg.muted) {
        if (last.pulse) {
          enqueue(forSpeech(pulseIntro(last.content), lang));
        } else {
          const { units } = speechUnits(last.content.slice(seg.consumed), true, lang);
          seg.consumed = last.content.length;
          for (const u of units) enqueue(u);
        }
      }
      flushedRef.current = true;
      if (speakingRef.current) maybeFinish();
      else if (!busyRef.current && micRef.current) listenOnce();
    } else if (!speakingRef.current && !busyRef.current && micRef.current) {
      listenOnce();
    }
  }, [active, streaming, messages, toolStatus, locale, enqueue, maybeFinish, listenOnce, stopRecognition]);

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

  // The page coming back into view: the audio context may have been suspended
  // behind our back (iOS, a backgrounded tab); ask for it back.
  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const ctx = audioCtxRef.current;
      if (ctx && (ctx.state as string) !== "running" && ctx.state !== "closed") ctx.resume().catch(() => { /* ignore */ });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active]);

  useEffect(() => () => {
    activeRef.current = false;
    cleanup();
    try { gainRef.current?.disconnect(); } catch { /* ignore */ }
    gainRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
  }, [cleanup]);

  return { supported, active, connecting: false, listening, speaking, error, toggle, interrupt };
}
