/**
 * The customer finishes their sentence (2026-10-28).
 *
 * Reported on the Emirates Post agent: "the voice command seem to be limited
 * with a around 5 second, i cannot complete my sentence if it is more than
 * that. we need to give the user flexibility and once silence for 2 seconds or
 * more, we can interrupt and process."
 *
 * The turn used to end when the browser's SpeechRecognition decided it had,
 * which is not configurable and is tuned for short commands. It now ends on a
 * meter reading the microphone, and this is that meter's rule, driven by
 * synthetic levels instead of a voice.
 *
 * Run from apps/web:  npx tsx scripts/test-voice-endpointing-2026-10-28.ts
 */
import { newMeterState, meterStep, type MeterEnd, type MeterState } from "../app/embed/[agent]/useVoiceChat";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};

const TICK = 50;
const QUIET = 0.004; // a room with echo cancellation on
const VOICE = 0.09; // an ordinary speaking level

/** Play a script of [level, milliseconds] and report when the turn ended. */
function run(script: [number, number][]): { endedAt: number | null; reason: MeterEnd } {
  let state: MeterState = newMeterState(0);
  let now = 0;
  for (const [level, ms] of script) {
    for (let t = 0; t < ms; t += TICK) {
      now += TICK;
      const r = meterStep(state, level, now);
      state = r.state;
      if (r.end) return { endedAt: now, reason: r.end };
    }
  }
  return { endedAt: null, reason: null };
}

console.log("\nthe reported bug — a long sentence with a pause in the middle");
{
  // Eight seconds of speech with a 1.4s think in the middle: one sentence.
  const r = run([[QUIET, 300], [VOICE, 4000], [QUIET, 1400], [VOICE, 4000], [QUIET, 3000]]);
  check("is not cut off at the pause", (r.endedAt ?? 0) > 9000, r);
  check("ends 2s after the customer actually stops", r.endedAt !== null && Math.abs(r.endedAt - 11750) <= 100, r);
  check("ends because of silence", r.reason === "silence", r.reason);
}

console.log("\nthe rule Emirates Post asked for");
{
  const r = run([[QUIET, 200], [VOICE, 1000], [QUIET, 5000]]);
  check("2.0s of silence ends the turn", r.reason === "silence" && r.endedAt !== null && r.endedAt - 1200 >= 2000, r);
  check("and not appreciably more", r.endedAt !== null && r.endedAt - 1200 < 2100, r);
}
{
  // The old behaviour, as a guard: 1.9s of quiet must NOT end it.
  let state = newMeterState(0);
  let now = 0;
  let ended: MeterEnd = null;
  for (const [level, ms] of [[VOICE, 1000], [QUIET, 1900]] as [number, number][]) {
    for (let t = 0; t < ms; t += TICK) { now += TICK; const r = meterStep(state, level, now); state = r.state; if (r.end) { ended = r.end; break; } }
    if (ended) break;
  }
  check("1.9s of silence does not", ended === null, ended);
}

console.log("\nthe limits around it");
{
  const r = run([[QUIET, 20000]]);
  check("a turn nobody speaks in closes at 15s", r.reason === "no-speech" && r.endedAt === 15000, r);
}
{
  // Someone who never stops: the ceiling, not the silence rule, ends it.
  const r = run([[VOICE, 70000]]);
  check("a turn nobody ends closes at 60s", r.reason === "too-long" && r.endedAt === 60000, r);
}

console.log("\nthe bar is absolute, not learned from the loudest thing heard");
{
  // The failure a learned floor would produce: speech from the very first tick.
  const r = run([[VOICE, 3000], [QUIET, 3000]]);
  check("speaking immediately still registers as speech", r.reason === "silence", r);
  check("and the turn ends 2s after it stops", r.endedAt !== null && Math.abs(r.endedAt - 5000) <= 100, r);
}
{
  // A noisy room must not be mistaken for a voice.
  const r = run([[0.012, 20000]]);
  check("room noise under the bar is not speech", r.reason === "no-speech", r);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
