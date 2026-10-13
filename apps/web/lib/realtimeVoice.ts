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
