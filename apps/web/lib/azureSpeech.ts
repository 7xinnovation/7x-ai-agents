/**
 * Azure Speech, as the voice routes speak it.
 *
 * WHY A SECOND ENGINE (2 November 2026). Reported: "the voice mode is poor, not
 * consistent, it stops midway." The voice had been gpt-realtime driven as a
 * text-to-speech engine — a conversational model told to read the reply aloud
 * "exactly as written". It mostly did, but a model that decides how to read is
 * a model that reads differently each time (the same 278-word reply came back
 * as 87.8, 88.5, 89.6 and 91.1 seconds of audio on four runs), and the three
 * WebSocket round trips before its first byte put 1.5 to 2.5 seconds between
 * the reply and the first word of it.
 *
 * The AI Foundry resource the key already opens is an Azure AI Services
 * resource, and those carry Azure Speech. Nothing to deploy: the same key
 * issues a Speech token and synthesises with the neural voices — measured at
 * 0.55 s to the first byte for a Dragon HD voice, deterministic, with native
 * Emirati Arabic voices the GPT voices never had. This file holds the protocol:
 * the URL, the SSML, the voice per language. The speak route drives it and
 * falls back to the realtime engine if it is ever unavailable.
 *
 * Kept out of the route file because a Next route may only export route fields,
 * and because the regression test reads these.
 */

export type SpeechLocale = "en" | "ar";

/**
 * The voices. English is British — the register of UAE English — and the
 * Dragon HD generation, which is the natural one. Arabic is Emirati. Mira is
 * one assistant with one name, so both default voices are female; Rashid
 * (ar-AE-Rashid:DragonHDLatestNeural) is the HD Emirati voice if quality is
 * ever preferred over that consistency — one environment variable.
 */
export const DEFAULT_VOICES: Record<SpeechLocale, string> = {
  en: "en-GB-Sonia:DragonHDLatestNeural",
  ar: "ar-AE-FatimaNeural",
};

/** The language the SSML declares, which is what the voice is told it is reading. */
const SSML_LANG: Record<SpeechLocale, string> = { en: "en-GB", ar: "ar-AE" };

/** The raw format the browser already plays: PCM16, 24 kHz, mono. */
export const OUTPUT_FORMAT = "raw-24khz-16bit-mono-pcm";

/**
 * Where to send the SSML.
 *
 * An AI Services resource answers Speech on its own hostname — the
 * `services.ai.azure.com` endpoint the realtime voice uses is also
 * `<resource>.cognitiveservices.azure.com`, and text to speech lives under
 * `/tts/` there. So with nothing configured the voice follows the resource,
 * whichever region it is in and whichever environment this is. `override` is
 * AZURE_SPEECH_ENDPOINT: a region name ("swedencentral") for the regional
 * host, or a full URL for anything else.
 */
export function speechUrl(realtimeEndpoint: string | undefined, override?: string): string | null {
  const o = (override ?? "").trim().replace(/\/$/, "");
  if (o) {
    if (/^https?:\/\//i.test(o)) return /\/cognitiveservices\/v1$/i.test(o) ? o : `${o}/cognitiveservices/v1`;
    if (/^[a-z0-9]+$/i.test(o)) return `https://${o.toLowerCase()}.tts.speech.microsoft.com/cognitiveservices/v1`;
    return null;
  }
  const m = (realtimeEndpoint ?? "").match(/^https?:\/\/([^./]+)\.(?:services\.ai\.azure\.com|cognitiveservices\.azure\.com|openai\.azure\.com)\/?$/i);
  if (!m) return null;
  return `https://${m[1]}.cognitiveservices.azure.com/tts/cognitiveservices/v1`;
}

/** The voice for a language: the environment's, else the default. */
export function voiceFor(locale: SpeechLocale, env: Record<string, string | undefined> = process.env): string {
  const v = (locale === "ar" ? env.VOICE_TTS_VOICE_AR : env.VOICE_TTS_VOICE_EN)?.trim();
  return v || DEFAULT_VOICES[locale];
}

/** Text into an XML text node. The reply is the customer's business, never markup. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * The SSML for one utterance. Plain: the Dragon HD voices read punctuation as
 * pacing on their own and ignore most prosody tags, and the text has already
 * been made speakable (forSpeech in useVoiceChat) before it gets here.
 */
export function ssmlFor(text: string, locale: SpeechLocale, voice: string): string {
  const lang = SSML_LANG[locale];
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
    `<voice name="${escapeXml(voice)}">${escapeXml(text)}</voice>` +
    `</speak>`
  );
}

/**
 * How long one utterance may take. Synthesis runs several times faster than
 * speech, so this is generous: a 300-character sentence gets 28 s.
 */
export function speechTimeoutMs(text: string): number {
  return 10000 + 60 * text.length;
}

/** The request, ready for fetch. */
export function speechRequest(text: string, locale: SpeechLocale, voice: string, key: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
      // Required by the service; the value is only for its logs.
      "User-Agent": "mira-voice",
    },
    body: ssmlFor(text, locale, voice),
    signal: AbortSignal.timeout(speechTimeoutMs(text)),
  };
}
