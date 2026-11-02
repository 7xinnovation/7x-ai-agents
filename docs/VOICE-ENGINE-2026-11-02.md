# Voice: a real text-to-speech engine, and a reply spoken as it is written

**Date:** 2 November 2026
**Agent:** NXN (Mira), the Emirates Post PO Box assistant
**Reported:** "the voice mode is poor — it's not consistent — it stops midway of speaking"

## What was wrong

Three separate things, each measured before anything was changed.

1. **The voice was a conversational model, not a text-to-speech engine.** `gpt-realtime-1.5` was
   opened over a WebSocket and told to read the reply aloud "exactly as written". It did read the
   whole reply (a 278-word test reply came back complete when its audio was transcribed again), but
   a model that decides how to read reads differently every time — the same text came back as
   87.8, 88.5, 89.6 and 91.1 seconds of audio on four runs — and the three round trips before its
   first byte put 1.5 to 2.5 seconds between the reply and the first word of it.
2. **On desktop, the voice was being stopped by its own echo.** The barge-in detector compares what
   the microphone hears while Mira speaks with what she is saying, and interrupts on two "new"
   words. Chrome's English recogniser mishears every name in the PO Box domain: *Mansoori* comes
   back as "man surrey", *Ajman and Fujairah* as "adge man and fuji ira". Two such mishearings in one
   result were two new words, which was the customer, which stopped the voice mid-sentence. This
   was reproduced against the real detector.
3. **Nothing was spoken until the whole reply was written.** Eight to sixteen seconds of tool rounds
   and writing, in silence, then the engine's start-up, then the first word.

## What changed

### The engine: Azure Speech, on the same resource, with the realtime voice as fallback

The AI Foundry resource the voice key already opens is an Azure AI Services resource, and those
carry Azure Speech. Nothing to deploy. The speak route (`/api/nxn/voice/speak`) now synthesises
with Azure Speech by default — one REST call, the audio streamed straight through, measured at
0.55 s to the first byte for a Dragon HD voice — and falls back to the realtime engine if Speech
is unavailable. Both emit the same bytes (PCM16, 24 kHz, mono), so the browser does not know
which one spoke.

| Setting | Default | Notes |
|---|---|---|
| `VOICE_TTS_ENGINE` | `azure-speech` | `realtime` to go back to the previous engine. Either way the other is the fallback. |
| `AZURE_SPEECH_ENDPOINT` | derived from `AZURE_REALTIME_ENDPOINT` | Only if Speech is not on the realtime resource: a region name (`swedencentral`) or a full URL. |
| `AZURE_SPEECH_KEY` | `AZURE_REALTIME_KEY` | |
| `VOICE_TTS_VOICE_EN` | `en-GB-Sonia:DragonHDLatestNeural` | British English, Dragon HD. |
| `VOICE_TTS_VOICE_AR` | `ar-AE-FatimaNeural` | Only used when Arabic is on Azure Speech (`VOICE_TTS_ENGINE_AR=azure-speech`). `ar-AE-Rashid:DragonHDLatestNeural` is the HD Emirati voice; it is set on prod and staging. |
| `VOICE_TTS_ENGINE_AR` | `realtime` | The engine for Arabic. See "Arabic: Emirati" below. |
| `VOICE_TTS_DIALECT_AR` | `emirati` | Rewrite Arabic into Emirati dialect before speaking; `off` to stop. |
| `VOICE_DIALECT_MODEL` | the main model | `fast` for the classifier model, or a model id. |

Short utterances (under 160 characters) are cached in the server's memory, so the spoken
acknowledgements below cost nothing the second time.

Protocol: `apps/web/lib/azureSpeech.ts`. Route: `apps/web/app/api/nxn/voice/speak/route.ts`.

### Arabic: Emirati, spoken by the LLM voice (later the same day)

Fourteen Arabic samples — Fatima, Hamdan, Rashid HD, the Gulf neighbours, the previous engine —
and the verdict was "all of them are robotic". They were all reading Modern Standard Arabic, the
register of news bulletins, and no voice makes that sound like a person at a counter in Deira.
So Arabic now takes a different path from English:

- **The engine is the realtime LLM voice** (`VOICE_TTS_ENGINE_AR=realtime`, the default), told to
  speak with an authentic Emirati accent — never Saudi, Egyptian or Levantine. English stays on
  Azure Speech. Each is the other's fallback. `lib/voiceEngines.ts`.
- **Each Arabic sentence is rewritten into Emirati dialect just before it is spoken**
  (`lib/emiratiDialect.ts`). The customer reads the formal reply and hears an Emirati one. The
  rewrite is held to the facts — every number, name and Latin word must survive or the original is
  spoken — and checked against a blocklist of the Saudi, Egyptian and Levantine forms models reach
  for when asked for "Gulf" Arabic: تبي is Saudi, an Emirati says تبا; وش → شو; أبغى → أبا;
  كذا → جذي; علشان → عشان. The commonest slips are corrected in place; anything else sends the
  sentence back to the original. `VOICE_TTS_DIALECT_AR=off` stops the rewrite;
  `VOICE_DIALECT_MODEL` chooses the model (unset = the main model, `fast` = the classifier model, about a second quicker).
- The response carries `X-Voice-Dialect` (emirati / none) and `X-Voice-Spoken`, the sentence as
  actually said, URL-encoded, so the probe can print it.
- Mira's name in Arabic is ميره, as everywhere else in the product.

The cost is latency: the rewrite (about a second) plus the realtime handshake before the first
Arabic word of each reply; later sentences are fetched while earlier ones play.

### The reply, one sentence at a time, while it streams

`useVoiceChat` no longer waits for the reply to finish. As the text streams it is cut into
speakable units — a sentence end followed by whitespace, a blank line, or a card — and each unit
is fetched and scheduled on one audio timeline the moment it is complete, so the first sentence is
heard while the agent is still writing the rest. An open card (a ```` ``` ```` block still being
written) is held back whole, so its internals are never voiced. A list number waits for its words.

Before any of the reply has been written, if the agent is away at a tool, the page's tool status
("Checking pricing…", "Fetching your account…") is spoken once, so the wait is acknowledged rather
than silent.

### Barge-in that does not mistake its own echo for the customer

A heard word is now also compared by its consonants with the words being spoken: "mn" and "fj"
are in *Mansoori* and *Fujairah*, so "man surrey" and "fuji ira" are the voice, misheard. And the
detector must hear the customer twice in a row (or in a final result) before it stops the voice:
a mishearing is a moment; a person interrupting keeps talking. Still desktop Chromium only; phones
interrupt with the **Speak now** tap, as before.

### The microphone meter

The bar a voice has to clear was lowered from 0.015 to 0.008 RMS, with the room still raising it
(speech must be 2.5× the quietest thing heard), and a sound now has to last 150 ms to count. A soft
speaker on a phone at arm's length is heard; a keyboard click is not.

### A recording nobody spoke in is not sent

Found while verifying production: one second of pure silence, sent to `/api/nxn/voice/transcribe`,
came back as *"How can I get a PO Box?"*. The transcriber is given the PO Box domain as a hint and,
handed nothing to hear, hears the hint. A turn the meter closed for no-speech used to be
transcribed and sent anyway, so a customer who sat quietly for fifteen seconds had a question
they never asked answered at length. Now, when the meter heard no speech and the device
recogniser heard no words either, nothing is sent and the microphone simply opens again.

### iOS

Safari puts the audio context into an "interrupted" state on a phone call, Siri, a notification
sound or the microphone opening, and in that state scheduled audio is silently never played — the
reply "stops midway" and the mic opens on the silence. The context now asks for itself back on its
own state change and when the page returns to view, and is re-checked after the microphone opens.

## Verifying

```
# the protocol, the segmentation, the detector, the meter, the route and hook shape (no mic needed)
npx tsx apps/web/scripts/test-voice-engine-2026-11-02.ts
npx tsx apps/web/scripts/test-voice-map-boxes-2026-10-13.ts
npx tsx apps/web/scripts/test-voice-endpointing-2026-10-28.ts
npx tsx apps/web/scripts/test-voice-in-the-app-2026-11-02.ts

# a running deployment: engine, voice, first byte, seconds of audio, cache
npx tsx apps/web/scripts/probe-voice-speak-2026-11-02.ts                      # staging
npx tsx apps/web/scripts/probe-voice-speak-2026-11-02.ts https://agent.7x.ae  # production
npx tsx apps/web/scripts/probe-voice-speak-2026-11-02.ts --engine realtime    # the fallback
```

## On a device — what to listen for

This cannot be tested without a microphone and a speaker. On an iPhone, an Android phone and a
desktop browser, with voice on:

- [ ] Mira starts speaking before the reply has finished appearing on screen.
- [ ] A reply with a branch name, a representative's name or an emirate in it is spoken to the end
      on desktop (it was these that cut out).
- [ ] Prices and box numbers are read the same way every time.
- [ ] After a long lookup, the status ("Fetching your account.") is heard before the reply.
- [ ] Speaking softly, at arm's length, ends the turn two seconds after you stop.
- [ ] Interrupting on desktop by talking over her works; a cough or a single word does not stop her.
- [ ] On a phone, **Speak now** stops her at once.
- [ ] Arabic: switch language and the voice switches with it.
- [ ] iPhone: lock and unlock mid-reply, or let a notification sound play — she carries on.

## Rolling back

`VOICE_TTS_ENGINE=realtime` on the App Service returns the previous engine, with Azure Speech as
its fallback. The browser changes stand on their own and do not depend on the engine.
