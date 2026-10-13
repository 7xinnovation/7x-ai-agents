# Voice, map and box numbers — 13 October 2026

Four bugs reported on 12–13 October, what each turned out to be, and what changed.

## 1. "It replies with two words and then disconnects and goes back to listening"

**Cause.** Azure retired the Realtime *preview* protocol (deprecated 30 April 2026).
Every text-to-speech session from `/api/nxn/voice/speak` was being refused with
`realtime_beta_access_required` and the route closed an **empty 200** stream. The
widget took the silence as "nothing played" and fell back to the device's own
speech engine. The barge-in detector was an energy meter on the microphone, and
the device voice coming out of the speakers is not covered by echo cancellation,
so it tripped a third of a second into every reply: two words, stop, "Listening".
A second laptop playing audio in the room trips the same meter.

**Fix.**
- The speak route speaks the GA protocol: `wss://<resource>/openai/v1/realtime?model=<deployment>`
  (no api-version), `session.update` typed `realtime` with the voice and PCM16 @ 24 kHz
  under `audio.output`, audio read from `response.output_audio.delta`. Verified: a
  two-sentence test returns ~290 KB of audio locally; the first chunk is awaited
  before any status is sent, so a failure is now a **502** a curl can see.
- Barge-in is decided by **words, not volume**: while the assistant speaks, a second
  recogniser listens and its hearing is compared with the text being spoken
  (`heardTheCustomer`). The assistant's own voice comes back as its own words and is
  ignored; two or more words of the customer's own stop the voice and open the mic.
  Numbers and the little shared words are left out of the comparison. Desktop
  Chromium only — Android's recogniser takes audio focus and Apple's announces every
  start with a tone — so phones interrupt with the new **Speak now** button on the
  voice bar, which desktops have too.
- `useVoiceChat` says once in the console when it falls back to the device voice.

## 2. Side talk appearing in the chat, repeatedly

With the voice cut off after every few hundred milliseconds the microphone was open
almost continuously, so whatever was said in the room was transcribed and sent, and
the agent answered each one. Locally the agent answers that sentence with "No
worries, take your time"; I could not find a code path that puts the customer's
speech into an *assistant* bubble as the screenshot shows, and could not reproduce
it. The fix above ends the loop: the voice is no longer interrupted by itself or by a
laptop in the room. A person speaking in the room still counts as the customer —
there is no wake word — so test with the room quiet.

## 3. "Couldn't load the map" after allowing location

**Cause.** `/api/nxn/branches` took the *first enabled* integration row for the agent,
and the list is newest-first. Since **EMX Tracking** was added on 22 September the
first row has been the tracking gateway, which has no `Rental/BoxLocations`: an empty
list on staging and production for every emirate, which the map component shows as a
load failure. The chat's own branch cards were fine because a tool knows its row.
Locally there is no tracking row, which is why it worked here.

**Fix.** The proxy picks the row named NXN (as `epGeocode` and `epSavedCards` do),
failing that the row carrying the branch operation. Verified: staging and production
return the real branch list after deploy (see the verification below).

## 4. "The agent is unable to show any PO Box in all emirates"

**Cause.** Emirates Post's `Rental/FreeBoxes` publishes availability only to Emirates
Post's **own** session. It answers 401 to the API key alone (verified again today
against staging) and to the UAE PASS access token this widget holds after a UAE PASS
sign-in. Inside Emirates Post's app and website the widget receives their session as
the host token, and there the same step works (production, 8 September: box 2062 at
office 201). On staging, the reserved test numbers that used to fill this gap are
switched off while the real hold step (`Rental/Select`) is live, because Select
rejects numbers that were never real. The mock persona on staging is simulated and
unaffected.

**What changed.** The agent now tells the truth instead of "temporary system issue":
available box numbers cannot be shown in this channel; continue in the Emirates Post
app or website, or request a callback; it never asks for a second sign-in.

**What is needed to make it work here.** One of: Emirates Post accepts UAE PASS tokens
on `Rental/FreeBoxes`; or issues a service credential for it; or exposes a UAE PASS →
Emirates Post session exchange the callback can call. Until then the rental journey
with a UAE PASS sign-in stops at the box step outside Emirates Post's own surfaces.

## Verification

- `apps/web/scripts/test-voice-map-boxes-2026-10-13.ts` — 21 checks.
- `curl -X POST -H 'Content-Type: application/json' -d '{"text":"Hello"}' <site>/api/nxn/voice/speak`
  must return 200 with audio bytes (0 bytes or 502 means the voice is down).
- `<site>/api/nxn/branches?agentSlug=nxn-dialog&emirate=DXB&bundle=IN` must list branches.
- `/api/nxn/voice/transcribe` was checked with a spoken clip on local and staging: correct text.
