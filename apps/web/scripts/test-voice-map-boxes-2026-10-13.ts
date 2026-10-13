/**
 * Regression for the 12–13 October bug report: the voice cut off after two
 * words, the map that could not load, and the box numbers no emirate could show.
 *
 *   npx tsx scripts/test-voice-map-boxes-2026-10-13.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realtimeUrl, sessionUpdate } from "../lib/realtimeVoice";
import { heardTheCustomer, bagOfWords, forSpeech } from "../app/embed/[agent]/useVoiceChat";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, rel), "utf8");
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
}

console.log("\nVoice — the GA realtime protocol");
const speak = src("../app/api/nxn/voice/speak/route.ts");
check("the URL is v1 with the model in the query and no api-version", realtimeUrl("https://res.services.ai.azure.com/", "gpt-realtime-1.5") === "wss://res.services.ai.azure.com/openai/v1/realtime?model=gpt-realtime-1.5");
const su = sessionUpdate("marin", "read it") as { type: string; session: { type: string; output_modalities: string[]; audio: { output: { voice: string; format: { type: string; rate: number } }; input: { turn_detection: null } } } };
check("the session is typed realtime, audio out, PCM16 at 24 kHz, no turn detection", su.type === "session.update" && su.session.type === "realtime" && su.session.output_modalities.join() === "audio" && su.session.audio.output.voice === "marin" && su.session.audio.output.format.type === "audio/pcm" && su.session.audio.output.format.rate === 24000 && su.session.audio.input.turn_detection === null);
check("the route reads the GA audio event and never the preview one", /case "response\.output_audio\.delta"/.test(speak) && !/case "response\.audio\.delta"/.test(speak) && !/api-version=/.test(speak + src("../lib/realtimeVoice.ts")));
check("a session with no audio is a 502, not an empty 200", /status: 502/.test(speak) && /voice_unavailable/.test(speak) && /FIRST_AUDIO_MS/.test(speak));
check("the route exports only route fields", !/^export (function|const) (?!runtime)/m.test(speak));

console.log("\nVoice — barge-in is words, not volume");
const hook = src("../app/embed/[agent]/useVoiceChat.ts");
check("the energy meter is gone", !/getFloatTimeDomainData|BARGE_RMS|createAnalyser/.test(hook));
check("a second recogniser runs only while speaking and is stopped when done", /startBargeListener\(\);/.test(hook) && /const done = \(\) => \{\s*stopBargeListener\(\);/.test(hook));
check("the hook exposes interrupt", /return \{ supported, active, connecting: false, listening, speaking, error, toggle, interrupt \}/.test(hook));
check("desktop only: Android and Apple devices interrupt by tap", /android\|iphone\|ipad\|ipod/.test(hook) && /navigator\.vendor/.test(hook));
check("an interrupted utterance returns at once instead of waiting out the audio", /if \(controller\.signal\.aborted\)/.test(hook));
check("the fallback to the device voice is said in the console once", /the natural voice is unavailable/.test(hook) && /warnedRef/.test(hook));
const spoken = forSpeech("Your MyBox costs **AED 300** per year, plus a one-time registration fee of AED 70. Which branch would you like?");
check("the assistant's own words, heard back, are not the customer", !heardTheCustomer("your my box costs 300 dirhams per year plus a one-time registration fee", spoken));
check("the voice's spelt-out numbers are not the customer either", !heardTheCustomer("three hundred dirhams per year plus a one time registration fee of seventy dirhams", spoken));
check("a fragment is not the customer", !heardTheCustomer("which branch", spoken) && !heardTheCustomer("", spoken));
check("the customer talking over it is", heardTheCustomer("sorry can you repeat that please", spoken));
check("side talk in the room counts as the customer (it is a person speaking)", heardTheCustomer("turn the volume down I am working now", spoken));
const spokenAr = forSpeech("صندوقك MyBox يكلّف 300 درهم في السنة. أي فرع تفضّل؟", "ar");
check("Arabic: the echo is ignored and the customer is heard", !heardTheCustomer("صندوقك يكلف 300 درهم في السنة أي فرع تفضل", spokenAr) && heardTheCustomer("لحظة من فضلك أريد تغيير الإمارة", spokenAr));
check("bagOfWords drops punctuation and case", [...bagOfWords("Hello, World! hello")].join() === "hello,world");

console.log("\nVoice — the experience");
const exp = src("../app/embed/[agent]/Experience.tsx");
check("the voice bar offers Speak now while the assistant speaks, in both languages", /voice\.speaking \? \(\s*<button type="button" className="dlg-voice-bar-stop" onClick=\{voice\.interrupt\}>\{t\.voiceInterrupt\}<\/button>/.test(exp) && /voiceInterrupt: "Speak now"/.test(exp) && /voiceInterrupt: "تحدّث الآن"/.test(exp));

console.log("\nMap — the branch proxy asks the PO Box integration");
const br = src("../app/api/nxn/branches/route.ts");
check("the row is chosen by name, then by carrying Rental/BoxLocations — never 'first enabled'", /\/nxn\/i\.test\(i\.name\)/.test(br) && /Rental\\\/BoxLocations/.test(br) && !/\.find\(\(i\) => i\.enabled && \(i\.environments\[env\] \|\| i\.environments\.staging\)\)/.test(br));

console.log("\nBoxes — the refusal is said straight");
const integ = src("../lib/integrations.ts");
check("a UAE PASS token refused by FreeBoxes is explained, not called temporary", /bearerSource === "identity" && \/Rental\\\/\(FreeBoxes\|GetRejectedBoxDetails\)\/i\.test\(op\.path\)/.test(integ) && /only to its OWN signed-in session/.test(integ) && /do NOT call it a system issue/.test(integ));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
