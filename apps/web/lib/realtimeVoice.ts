/**
 * The Azure realtime GA protocol, as the voice routes speak it.
 *
 * Kept out of the route file because a Next route may only export route fields;
 * the speak route imports these, and the regression test reads them.
 */

/** The GA realtime URL for this resource: v1, model named in the query, no api-version. */
export function realtimeUrl(endpoint: string, deployment: string): string {
  const host = endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `wss://${host}/openai/v1/realtime?model=${encodeURIComponent(deployment)}`;
}

/** The GA session: speech out, verbatim, PCM16 at 24 kHz, and no turn detection — we drive every turn. */
export function sessionUpdate(voice: string, instructions: string) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      output_modalities: ["audio"],
      instructions,
      audio: {
        output: { voice, format: { type: "audio/pcm", rate: 24000 } },
        input: { turn_detection: null },
      },
    },
  };
}

/**
 * "EXACTLY as written" was doing more work than intended.
 *
 * Emirates Post, 13 September: the voice was saying "dot dot dot". Told to read
 * the text exactly, and handed an ellipsis, it did. The text is cleaned before
 * it gets here now — see forSpeech in useVoiceChat — but the instruction is the
 * belt to that braces: punctuation is pacing, and pacing is not a word.
 */
const VERBATIM =
  "Read the user's message aloud EXACTLY as written. Do not add, omit, translate, summarise or comment on anything — just voice the text. " +
  "NEVER SPEAK PUNCTUATION ALOUD. A full stop, an ellipsis, a comma, a dash, an asterisk or a bracket is pacing, not a word: pause for it, never name it. Never say 'dot', 'dot dot dot', 'asterisk', 'dash', 'hyphen' or 'bracket'. If a line contains nothing but punctuation, say nothing for it. " +
  "Read nothing but speech: no markup, no symbols, no sound effects, no tones.";

/**
 * What the voice is told, per language.
 *
 * English: warm, natural, numbers said the natural way. Arabic: EMIRATI. The
 * text arriving here is already in Emirati dialect (see lib/emiratiDialect);
 * the voice has to carry the accent — the Gulf accent of Dubai and Abu Dhabi,
 * not Saudi, not Egyptian, not Levantine — and the calm, friendly rhythm of
 * someone at a counter, never a newsreader.
 */
export function ttsInstructions(locale: "en" | "ar"): string {
  if (locale === "ar") {
    return (
      "You are ميره (Mira), the spoken voice of Emirates Post's PO Box assistant. " +
      "Speak ARABIC in an authentic EMIRATI accent — the Gulf accent of Dubai, Abu Dhabi and Sharjah — never Saudi, Egyptian or Levantine. " +
      "Pronounce words the Emirati way (for example ق as a hard g, and ج softened to a y sound where Emiratis do), in a warm, calm, conversational tone, like a friendly Emirati customer-service agent. Not a newsreader. " +
      VERBATIM + " Say numbers and prices the way an Emirati says them in everyday speech (e.g. 695 درهم as ستمية وخمسة وتسعين درهم)."
    );
  }
  return (
    "You are Mira, the spoken voice of Emirates Post's PO Box assistant. " + VERBATIM.replace("Read the user's message aloud EXACTLY as written.", "Read the user's message aloud EXACTLY as written, in a warm, natural, helpful tone.") +
    " Speak prices and numbers naturally (e.g. 'AED 695' as 'six hundred ninety-five dirhams')."
  );
}
