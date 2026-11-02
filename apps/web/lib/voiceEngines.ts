/**
 * Which engine speaks which language.
 *
 * 2 November 2026, after listening: every Azure Speech Arabic voice — the
 * Emirati ones included — reads formal Arabic like a news bulletin, and Emirates
 * Post's customers do not talk like a news bulletin. The LLM voice (gpt-realtime)
 * speaks rather than reads, and takes an accent instruction. So Arabic goes
 * through the realtime engine by default, and English stays on Azure Speech,
 * which is faster, deterministic and natural in English. Each is the other's
 * fallback.
 */
export type Engine = "azure-speech" | "realtime";
export type VoiceLocale = "en" | "ar";

function parse(v: string | undefined): Engine | null {
  return v === "realtime" || v === "azure-speech" ? v : null;
}

/** The engine for a language: VOICE_TTS_ENGINE_AR / VOICE_TTS_ENGINE, else the defaults above. */
export function engineFor(locale: VoiceLocale, env: Record<string, string | undefined> = process.env): Engine {
  if (locale === "ar") return parse(env.VOICE_TTS_ENGINE_AR) ?? "realtime";
  return parse(env.VOICE_TTS_ENGINE) ?? "azure-speech";
}

/** The order to try: the one asked for (a request may name one), else the language's, then the other. */
export function engineOrder(locale: VoiceLocale, asked: Engine | null, env: Record<string, string | undefined> = process.env): Engine[] {
  const first = asked ?? engineFor(locale, env);
  return first === "realtime" ? ["realtime", "azure-speech"] : ["azure-speech", "realtime"];
}

/** Whether Arabic is rewritten into Emirati dialect before it is spoken. VOICE_TTS_DIALECT_AR=off turns it off. */
export function emiratiDialectOn(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.VOICE_TTS_DIALECT_AR ?? "emirati").trim().toLowerCase();
  return v !== "off" && v !== "0" && v !== "false" && v !== "none";
}
