/**
 * Voice, 2 November 2026: "the voice mode is poor — not consistent — it stops
 * midway of speaking."
 *
 * What changed, and what this checks without a microphone:
 *  - the reply is spoken one sentence at a time as it streams (speechUnits);
 *  - the speak route's default engine is Azure Speech on the same resource,
 *    with the realtime voice as fallback (lib/azureSpeech, the route);
 *  - the desktop barge-in detector no longer takes a misheard name for the
 *    customer (isEcho, heardTheCustomer), and needs to hear them twice;
 *  - the microphone meter hears a soft speaker and ignores a click;
 *  - the audio context is asked back when iOS interrupts it.
 *
 *   npx tsx scripts/test-voice-engine-2026-11-02.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  speechUnits, heardTheCustomer, isEcho, consonants, forSpeech,
  newMeterState, meterStep, type MeterEnd, type MeterState,
} from "../app/embed/[agent]/useVoiceChat";
import { speechUrl, ssmlFor, voiceFor, speechTimeoutMs, DEFAULT_VOICES, escapeXml } from "../lib/azureSpeech";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(resolve(here, p), "utf8");
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
}

console.log("\nThe reply, one sentence at a time, while it streams");
{
  const r = speechUnits("Thank you, Ahmed. I have found your account and here", false);
  check("a complete sentence is spoken as soon as the next word begins", r.units.join("|") === "Thank you, Ahmed." && r.consumed === 17, r);
  check("a sentence that may still be going on is held", speechUnits("Hello there.", false).units.length === 0);
  check("…and spoken when the reply is final", speechUnits("Hello there.", true).units.join("|") === "Hello there.");
  check("a decimal is not a sentence end", speechUnits("The fee is AED 695.00 per year. Next", false).units.join("|") === "The fee is AED 695.00 per year.");
  check("a web address is not a sentence end", speechUnits("See www.emiratespost.ae for more. Then", false).units.join("|") === "See the link below for more.");
  const open = speechUnits("Here are your options.\n\n```buttons\n- Renew for one year\n- Renew for two", false);
  check("an open card is held back whole — none of it is voiced", open.units.join("|") === "Here are your options." && open.consumed <= "Here are your options.\n\n".length, open);
  const closed = speechUnits("Here are your options.\n\n```buttons\n- Renew for one year\n```\nWhich one would you like?", true);
  check("a closed card is silent, and a boundary", closed.units.join("|") === "Here are your options.|Which one would you like?", closed);
  const list = speechUnits("You have two choices:\n\n1. Renew for one year.\n2. Renew for two years.", true);
  check("a list number waits for its words", list.units.join("|") === "You have two choices:|1. Renew for one year.|2. Renew for two years.", list);
  check("Arabic sentence ends count", speechUnits("أهلاً بك. كيف أساعدك؟ ", false, "ar").units.length === 2);
  check("a reply that is only a card has nothing to say", speechUnits("```summary\nbox: 12345\n```", true).units.length === 0);
  // Fed in pieces, as a stream is, the units must come out the same.
  const text = "Thank you, Ahmed. Your box expired on 30 September. To renew for one year the fee is AED 695.00 including VAT.\n\n```buttons\n- One year\n- Two years\n```\nWhich would you like?";
  const whole = speechUnits(text, true).units;
  const streamed: string[] = [];
  let consumed = 0;
  for (let n = 7; n < text.length; n += 7) {
    const r = speechUnits(text.slice(consumed, n), false);
    consumed += r.consumed;
    streamed.push(...r.units);
  }
  streamed.push(...speechUnits(text.slice(consumed), true).units);
  check("streamed in pieces, the same sentences come out in the same order", streamed.join("|") === whole.join("|"), { whole, streamed });
  check("and none of them is the inside of the card", !streamed.some((u) => /One year|Two years/.test(u)));
}

console.log("\nBarge-in: a misheard name is not the customer");
{
  const spoken = forSpeech("Your PO Box number 12345 at the Deira Main branch in Dubai expired on the thirtieth of September. I can also add the MyHome delivery service to your home address in Al Barsha. You can pay with Noqodi through UAE Pay. The registered representative on this box is still Fatima Al Mansoori. Your box at the Ajman and Fujairah branches. Shall I include the MyHome delivery service?");
  check("consonants: what a mishearing keeps", consonants("Mansoori") === "mnsr" && consonants("man") === "mn" && consonants("Fujairah") === "fjr");
  check("Mansoori heard as 'man surrey' is the voice", !heardTheCustomer("is still Fatima al man surrey", spoken));
  check("Ajman and Fujairah heard as 'adge man and fuji ira' is the voice", !heardTheCustomer("your box at the adge man and fuji ira branches", spoken));
  check("Deira heard as 'there a' is the voice", !heardTheCustomer("at the there a main branch in Dubai", spoken));
  check("Al Barsha heard as 'albert shah' is the voice", !heardTheCustomer("your home address in albert shah", spoken));
  check("Noqodi heard as 'no body' is the voice", !heardTheCustomer("you can pay with no body through you a pay", spoken));
  check("the customer asking to repeat is still the customer", heardTheCustomer("sorry can you repeat that please", spoken));
  check("the customer interrupting with something else is still the customer", heardTheCustomer("wait actually can you stop please I want two years", spoken));
  check("side talk in the room still counts", heardTheCustomer("turn the volume down I am working now", spoken));
  const spokenAr = forSpeech("صندوقك MyBox يكلّف 300 درهم في السنة. أي فرع تفضّل؟", "ar");
  check("Arabic is compared whole: the echo is ignored and the customer is heard", !heardTheCustomer("صندوقك يكلف 300 درهم في السنة أي فرع تفضل", spokenAr) && heardTheCustomer("لحظة من فضلك أريد تغيير الإمارة", spokenAr));
  check("isEcho: an Arabic word is never dismissed by its consonants", !isEcho("تغيير", ["mnsr"]));
}

console.log("\nThe meter: a soft speaker is heard, a click is not");
{
  const TICK = 50;
  const run = (script: [number, number][]): { endedAt: number | null; reason: MeterEnd } => {
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
  };
  const soft = run([[0.004, 300], [0.012, 3000], [0.004, 3000]]);
  check("a soft speaker in a quiet room is speech", soft.reason === "silence", soft);
  check("and the turn ends 2s after they stop", soft.endedAt !== null && Math.abs(soft.endedAt - 5300) <= 100, soft);
  const noisy = run([[0.012, 20000]]);
  check("the same level with no quiet under it is a noisy room, not speech", noisy.reason === "no-speech", noisy);
  const click = run([[0.004, 300], [0.09, 100], [0.004, 20000]]);
  check("a 100 ms click is not speech", click.reason === "no-speech" && click.endedAt === 15000, click);
  const word = run([[0.004, 300], [0.09, 200], [0.004, 5000]]);
  check("200 ms of voice is", word.reason === "silence", word);
}

console.log("\nAzure Speech: the protocol");
{
  check("the Speech URL follows the realtime resource — nothing to configure", speechUrl("https://aif-7xil-core-stg.services.ai.azure.com") === "https://aif-7xil-core-stg.cognitiveservices.azure.com/tts/cognitiveservices/v1");
  check("a trailing slash is fine", speechUrl("https://aif-7xil-core-stg.services.ai.azure.com/") === "https://aif-7xil-core-stg.cognitiveservices.azure.com/tts/cognitiveservices/v1");
  check("a region name goes to the regional host", speechUrl("https://x.services.ai.azure.com", "swedencentral") === "https://swedencentral.tts.speech.microsoft.com/cognitiveservices/v1");
  check("a full URL is used as given", speechUrl(undefined, "https://my.speech.example/cognitiveservices/v1") === "https://my.speech.example/cognitiveservices/v1");
  check("no endpoint, no URL", speechUrl(undefined) === null && speechUrl("not a url") === null);
  check("the default voices are British English and Emirati Arabic", /^en-GB-/.test(DEFAULT_VOICES.en) && /^ar-AE-/.test(DEFAULT_VOICES.ar));
  check("the environment may choose the voice", voiceFor("ar", { VOICE_TTS_VOICE_AR: "ar-AE-Rashid:DragonHDLatestNeural" }) === "ar-AE-Rashid:DragonHDLatestNeural" && voiceFor("en", {}) === DEFAULT_VOICES.en);
  const ssml = ssmlFor("Fees & charges <apply> for \"MyBox\"", "ar", "ar-AE-FatimaNeural");
  check("the SSML declares Arabic, names the voice, and escapes the text", /xml:lang="ar-AE"/.test(ssml) && /<voice name="ar-AE-FatimaNeural">/.test(ssml) && /Fees &amp; charges &lt;apply&gt; for &quot;MyBox&quot;/.test(ssml));
  check("escapeXml handles every reserved character", escapeXml("&<>\"'") === "&amp;&lt;&gt;&quot;&apos;");
  check("a longer sentence is given longer", speechTimeoutMs("a".repeat(300)) > speechTimeoutMs("a") && speechTimeoutMs("") >= 10000);
}

console.log("\nThe speak route");
{
  const route = src("../app/api/nxn/voice/speak/route.ts");
  check("Azure Speech is the default engine and VOICE_TTS_ENGINE may say otherwise", /process\.env\.VOICE_TTS_ENGINE === "realtime" \? "realtime" : "azure-speech"/.test(route));
  check("the engines fall back to each other", /\["realtime", "azure-speech"\] : \["azure-speech", "realtime"\]/.test(route));
  check("the request says which language is being spoken", /body\?\.locale === "ar"/.test(route));
  check("the response says which engine spoke", /"X-Voice-Engine": "azure-speech"/.test(route) && /"X-Voice-Engine": "realtime"/.test(route));
  check("short utterances are cached, so acknowledgements cost nothing the second time", /CACHE_MAX_CHARS/.test(route) && /"X-Voice-Cache": "hit"/.test(route));
  check("the realtime fallback still speaks the GA protocol", /case "response\.output_audio\.delta"/.test(route) && !/api-version=/.test(route));
  check("a realtime response the model did not complete is logged, even with some audio", /status !== "completed"/.test(route));
  check("nothing configured is a 501, a failure is a 502", /501\)/.test(route) && /status: 502|\? 501 : 502/.test(route));
  check("the route exports only route fields", !/^export (function|const) (?!runtime)/m.test(route));
}

console.log("\nThe hook");
{
  const hook = src("../app/embed/[agent]/useVoiceChat.ts");
  check("the stream is cut into units as it arrives, and flushed when it ends", /speechUnits\(last\.content\.slice\(seg\.consumed\), false, lang\)/.test(hook) && /speechUnits\(last\.content\.slice\(seg\.consumed\), true, lang\)/.test(hook));
  check("the tool status is spoken once per reply, before any of it is written", /if \(toolStatus && !seg\.acked\)/.test(hook) && /enqueue\(forSpeech\(toolStatus, lang\)\)/.test(hook));
  check("an interrupted reply stays silent to its end", /segRef\.current\.muted = true/.test(hook) && /if \(seg\.muted \|\| last\.pulse\) return;/.test(hook));
  check("the customer must be heard twice, or in a final result", /BARGE_CONFIRMATIONS = 2/.test(hook) && /isFinal \|\| bargeHitsRef\.current >= BARGE_CONFIRMATIONS/.test(hook));
  check("the speak request carries the language", /locale: localeRef\.current === "ar" \? "ar" : "en"/.test(hook));
  check("one gain node for the context's life — never disconnected per sentence", /gainRef\.current = ctx\.createGain\(\)/.test(hook) && !/gain\.disconnect\(\)/.test(hook));
  check("the audio context is asked back when iOS interrupts it, and when the page returns", /onstatechange/.test(hook) && /visibilitychange/.test(hook));
  check("the public API is unchanged", /return \{ supported, active, connecting: false, listening, speaking, error, toggle, interrupt \}/.test(hook));
  const exp = src("../app/embed/[agent]/Experience.tsx");
  check("the page hands the tool status to the voice", /useVoiceChat\(\{[^}]*toolStatus \}\)/.test(exp));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
