/**
 * The microphone button, inside the Emirates Post app (2026-11-02).
 *
 * Asked for: "on the mobile app can we enable the audio button again for
 * emiratespost agent? so the users can speak to the agent".
 *
 * Two separate things kept it hidden there, and only one of them was deliberate:
 *
 *  1. the native gate — off unless the app sets `window.__dialogNativeVoice`,
 *     because reaching for a microphone the app has no usage description for
 *     gets the app killed by iOS. That one stays, and is the app's to lift.
 *  2. the SpeechRecognition requirement — an accident. An Android WebView has
 *     no recogniser and a WKWebView has one that never prompts, so the button
 *     was hidden on the host it was wanted on even with the gate open.
 *
 * This is the rule as it now stands.
 *
 * Run from apps/web:  npx tsx scripts/test-voice-in-the-app-2026-11-02.ts
 */
import { micUsable } from "../app/embed/[agent]/useVoiceChat";
import { voiceMode } from "../app/embed/[agent]/nativeBridge";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

/** An ordinary desktop browser: everything present. */
const browser = {
  recognition: true, recorder: true, microphone: true,
  nativeAllowed: true, audioContext: true, synthesis: true, serverStt: true,
};
/** The app, once it has the microphone permission and sets the global. */
const androidWebView = { ...browser, recognition: false };
/** A WKWebView, where the recogniser exists but never actually answers. */
const iosWebView = { ...browser };

console.log("\nthe hosts");
check("a browser shows the button", micUsable(browser) === true);
check("an Android WebView shows it too — the server does the transcribing", micUsable(androidWebView) === true);
check("a WKWebView shows it", micUsable(iosWebView) === true);

console.log("\nthe native gate is untouched");
check("no button until the app says the mic is permitted", micUsable({ ...androidWebView, nativeAllowed: false }) === false);
check("and that holds even for a host with its own recogniser", micUsable({ ...browser, nativeAllowed: false }) === false);

console.log("\nnothing to hear with");
check("no recogniser and no server transcription — no button", micUsable({ ...androidWebView, serverStt: false }) === false);
check("no recogniser and no AudioContext to end the turn — no button", micUsable({ ...androidWebView, audioContext: false }) === false);
check("a device recogniser carries a host with no server transcription", micUsable({ ...browser, serverStt: false }) === true);

console.log("\nthe other halves");
check("no recorder, no button", micUsable({ ...browser, recorder: false }) === false);
check("no getUserMedia, no button", micUsable({ ...browser, microphone: false }) === false);
check("nothing can speak the reply back, no button", micUsable({ ...browser, audioContext: false, synthesis: false }) === false);
check("speechSynthesis alone can speak the reply for a host with a recogniser", micUsable({ ...browser, audioContext: false }) === true);

console.log("\nwhen the app asks for the permission (their developer, 2 November)");
check("a browser is never waiting on an app", voiceMode(false, undefined) === "on");
check("an app that says nothing gets no microphone", voiceMode(true, undefined) === "off");
check("true still means the permission is already granted", voiceMode(true, true) === "on");
check("\"ask\" shows the button and waits for the tap to be answered", voiceMode(true, "ask") === "ask");
check("a half-written flag is not a yes", voiceMode(true, "yes") === "off");
check("and neither is a truthy object", voiceMode(true, {}) === "off");
check("both ways show the button", micUsable({ ...androidWebView, nativeAllowed: voiceMode(true, "ask") !== "off" }) === true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
