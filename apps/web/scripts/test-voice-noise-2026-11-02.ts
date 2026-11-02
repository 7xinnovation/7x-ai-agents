/**
 * Voice, 2 November 2026 (evening): "sometimes if there was noise in the room
 * it stops talking."
 *
 * Two gates, both testable without a microphone:
 *  - the barge-in's near-field gate (nearStep): words from across the room do
 *    not interrupt Mira; a customer at the microphone does;
 *  - the transcriber's confidence gate (lib/transcribeGate): silence and noise,
 *    which the model turns into its own hint phrases, are not messages.
 *
 *   npx tsx scripts/test-voice-noise-2026-11-02.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { newNearState, nearStep, NEAR_RMS, newMeterState, meterStep, type MeterEnd, type MeterState } from "../app/embed/[agent]/useVoiceChat";
import { judge, confidence, echoesVocabulary, vocabularyPrompt, REJECT_AVG, VOCABULARY } from "../lib/transcribeGate";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(resolve(here, p), "utf8");
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
}

/** Feed levels (one per 50 ms tick) and report whether the gate ever opened, and when. */
function play(levels: number[]): { near: boolean; at: number | null } {
  let state = newNearState();
  for (let i = 0; i < levels.length; i++) {
    const r = nearStep(state, levels[i]!);
    state = r.state;
    if (r.near) return { near: true, at: i * 50 };
  }
  return { near: false, at: null };
}
const ticks = (level: number, ms: number) => Array(Math.round(ms / 50)).fill(level) as number[];

console.log("\nThe near-field gate: who is talking to the microphone?");
{
  check("silence while Mira speaks: nobody", !play(ticks(0.004, 3000)).near);
  check("chatter across the office (0.012) is not the customer", !play([...ticks(0.004, 500), ...ticks(0.012, 3000)]).near);
  check("louder chatter, up to the bar itself, still is not", !play([...ticks(0.004, 500), ...ticks(NEAR_RMS, 3000)]).near);
  check("what echo cancellation leaves of Mira's own voice (steady 0.02) is not", !play(ticks(0.02, 4000)).near);
  const customer = play([...ticks(0.004, 500), ...ticks(0.08, 1500)]);
  check("a customer at the microphone is, within a second", customer.near && customer.at !== null && customer.at - 500 <= 1000, customer);
  check("a cough is not", !play([...ticks(0.004, 500), ...ticks(0.12, 150), ...ticks(0.004, 2000)]).near);
  const noisy = play([...ticks(0.015, 1000), ...ticks(0.03, 1000), ...ticks(0.09, 1500)]);
  check("in a noisy room the bar rises with the room, and a loud customer still clears it", noisy.near, noisy);
  check("in that noisy room, the room itself does not", !play([...ticks(0.015, 1000), ...ticks(0.03, 3000)]).near);
}

console.log("\nThe turn meter: the bar is higher and a sound has to last");
{
  const TICK = 50;
  const run = (script: [number, number][]): { endedAt: number | null; reason: MeterEnd } => {
    let state: MeterState = newMeterState(0);
    let now = 0;
    for (const [level, ms] of script) for (let t = 0; t < ms; t += TICK) { now += TICK; const r = meterStep(state, level, now); state = r.state; if (r.end) return { endedAt: now, reason: r.end }; }
    return { endedAt: null, reason: null };
  };
  check("office chatter at 0.012 over a quiet floor is not speech", run([[0.004, 300], [0.012, 20000]]).reason === "no-speech");
  check("a 200 ms burst is not speech", run([[0.004, 300], [0.09, 200], [0.004, 20000]]).reason === "no-speech");
  check("a customer at 0.05 is, and the turn ends 2 s after they stop", (() => { const r = run([[0.004, 300], [0.05, 2000], [0.004, 3000]]); return r.reason === "silence" && r.endedAt !== null && Math.abs(r.endedAt - 4300) <= 100; })());
}

console.log("\nThe transcriber's confidence gate");
{
  const lp = (...v: number[]) => v.map((logprob) => ({ logprob }));
  check("confidence summarises the tokens", JSON.stringify(confidence(lp(-0.01, -0.02, -0.03))) === JSON.stringify({ avg: -0.02, min: -0.03, tokens: 3 }) && confidence([]) === null && confidence(undefined) === null);
  // The measured cases, 2 November.
  check("real speech is accepted", judge("Hello, I would like to renew my PO Box in Dubai.", lp(...Array(17).fill(-0.009)), "en").accept);
  check("real Arabic speech is accepted", judge("أريد تجديد صندوق البريد في دبي لسنة واحدة.", lp(...Array(12).fill(-0.002)), "ar").accept);
  const silence = judge("renew my PO Box", lp(-0.1, -0.02, -1.67, 0), "en");
  check("silence that became 'renew my PO Box' (avg -0.42) is rejected", !silence.accept && silence.reason === "low-confidence", silence);
  const hum = judge("MyBox.", lp(-1.57, -0.9, -0.6), "en");
  check("hum that became 'MyBox.' (avg -1.0) is rejected", !hum.accept, hum);
  const echo = judge("Emirates Post MyBox", lp(-0.08, -0.07, -0.06), "en");
  check("the hint's own words, with only middling confidence, are the hint coming back", !echo.accept && echo.reason === "vocabulary-echo", echo);
  check("…but the same words said with real confidence are a customer", judge("Emirates Post MyBox", lp(-0.01, -0.01, -0.01), "en").accept);
  const short = judge("track", lp(-0.2, -0.1), "en");
  check("a short unsure transcript is rejected", !short.accept && short.reason === "short-and-unsure", short);
  check("a longer transcript may be less sure and still pass", judge("I want to change the address on my box to Al Barsha please", lp(...Array(14).fill(-0.2)), "en").accept);
  check("no confidences at all: accepted, as before", judge("hello there", undefined, "en").accept);
  check("empty is empty, not rejected", judge("  ", lp(-0.01), "en").reason === "empty");
  check("the bar sits far from real speech and well above noise", REJECT_AVG < -0.1 && REJECT_AVG > -0.4);
  check("the hint is a vocabulary — no sentence to echo", !/rent a new PO Box|renew my PO Box|track a shipment/.test(vocabularyPrompt("en")) && /MyBox/.test(vocabularyPrompt("en")) && /بريد الإمارات/.test(vocabularyPrompt("ar")));
  check("the Arabic hint carries the Latin brand names too", VOCABULARY.ar.includes("MyBox"));
  check("echoesVocabulary: hint words only vs a real sentence", echoesVocabulary("renew my PO Box", "en") && !echoesVocabulary("I moved to Sharjah last month", "en"));
}

console.log("\nThe wiring");
{
  const hook = src("../app/embed/[agent]/useVoiceChat.ts");
  check("the barge-in needs words AND a speaker near the microphone", /heardTheCustomer\(heard, spokenTextRef\.current\) && \(nearRef\.current \? nearRef\.current\(\) : true\)/.test(hook));
  check("the near meter runs only while she speaks, and stops with the listener", /if \(autoBargeIn\(\)\) startNearMeter\(\);/.test(hook) && /const stopBargeListener = useCallback\(\(\) => \{\s*nearStopRef\.current\?\.\(\);/.test(hook));
  check("automatic gain is off and voice isolation asked for", /autoGainControl: false, voiceIsolation: true/.test(hook));
  check("the microphone reopens a beat after her last word", /REOPEN_MS = 300/.test(hook) && /setTimeout\(listenOnce, REOPEN_MS\)/.test(hook));
  check("the transcriber is told the conversation's language", /\/api\/nxn\/voice\/transcribe\?lang=\$\{localeRef\.current === "ar" \? "ar" : "en"\}/.test(hook));
  const route = src("../app/api/nxn/voice/transcribe/route.ts");
  check("the route asks for confidences and judges them", /form\.append\("include\[\]", "logprobs"\)/.test(route) && /judge\(text, j\.logprobs, locale\)/.test(route));
  check("a rejected transcript is empty text with the reason in a header, never an error", /X-Transcribe-Rejected/.test(route) && /NextResponse\.json\(\{ text: "", rejected: v\.reason \}, \{ headers \}\)/.test(route));
  check("the scores travel back for calibration", /X-Transcribe-Confidence/.test(route));
  check("the hint is the vocabulary, in the conversation's language", /vocabularyPrompt\(locale\)/.test(route) && /searchParams\.get\("lang"\) === "ar"/.test(route));
  check("the language is a hint, not forced", !/form\.append\("language"/.test(route));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
