# Turning the microphone back on in the Emirates Post app

**For:** the Emirates Post mobile app team
**From:** 7x — PO Box agent (Mira)
**Date:** 2 November 2026

Emirates Post have asked for the speak-to-the-agent button to come back in the
app. Our side is ready. The switch is in the app, and it is three small things.

---

## Background — why it is off today

On 11 September the app team filed: *"Major — the app crashed on clicking the
speak (microphone) icon."*

That was not a crash in our page. The screenshot is iOS reporting that
*(QA)Emirates Post* crashed, which is what the OS does to a process that reaches
for the microphone with no `NSMicrophoneUsageDescription` in its `Info.plist`.

`navigator.mediaDevices.getUserMedia` exists inside a WKWebView whether or not
the app around it is permitted to record, so our page could not tell the
difference — it found out by taking the app down with it.

So we turned the microphone off inside the app by default, and left the app in
charge of saying when it is safe. That is still the arrangement, and this note
is how to say it.

---

## What we changed on our side (done, on staging)

The button also required the WebView to provide the browser's own
`SpeechRecognition` API. It does not: an Android WebView exposes none at all,
and a WKWebView exposes the constructor but never raises the permission prompt
behind it, so it quietly returns nothing.

That requirement is gone. Speech is now recorded in the page and transcribed on
our server, which works the same in a WebView as in a browser. Nothing further
is needed from us.

---

## What the app needs

### 1. iOS

- `NSMicrophoneUsageDescription` in `Info.plist`.
  Without it the OS kills the process — this is the September crash.
- Grant the WebView's request (iOS 15+):

  ```swift
  func webView(_ webView: WKWebView,
               requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo,
               type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
      decisionHandler(.grant)
  }
  ```

  Left unimplemented, the page simply never receives a microphone.

### 2. Android

- `RECORD_AUDIO` in the manifest **and** requested at runtime.
- Grant it to the WebView:

  ```java
  webView.setWebChromeClient(new WebChromeClient() {
      @Override public void onPermissionRequest(final PermissionRequest request) {
          request.grant(request.getResources());   // RESOURCE_AUDIO_CAPTURE
      }
  });
  ```

  An Android WebView denies this by default and reports nothing back to the
  page, so it is not optional.

### 3. The switch — and when you ask for the permission

> *"The mic permission needs to be requested before use, the best way to trigger
> this request is when the mic button is clicked. The simplest way is to request
> it before opening the chat."* — 2 November

Both work, and the difference is one value. Set this global **before the page's
scripts run** — the same place the app already sets the sign-in token:

**A — you ask at launch (the simple one).** Request the permission before
opening the chat; if the customer grants it:

```js
window.__dialogNativeVoice = true;   // permission already granted
```

The page then opens the microphone itself, exactly as it does in a browser.

**B — you ask on the tap (the one you prefer).**

```js
window.__dialogNativeVoice = "ask";  // I will ask when they tap
```

The button is shown, and on the tap the page sends you

```json
{ "source": "dialog-native", "action": "mic-permission" }
```

through `window.ReactNativeWebView.postMessage` — the same channel as
`signin-needed`. Put the OS dialog up, then tell the page what happened:

```js
webView.injectJavaScript(`window.dispatchEvent(new CustomEvent('dialog-native',
  { detail: { action: 'voice-allowed' } }));`);   // or 'voice-denied'
```

The microphone is not touched until that arrives. No answer within 30 seconds is
read as a no — the page says "Microphone access is needed" rather than reaching
for a mic on a maybe, which on iOS is the crash above. Once granted, it is not
asked again for the rest of that chat.

With neither value set the button is simply not there, which is better than a
button that ends the session.

---

## Testing it

Point a test build at staging and the button should appear in the composer:

```
https://7xagents.7x-lab.com/embed/nxn-dialog
```

Tap it, speak, and the agent should answer out loud. One difference worth
knowing: inside the app, talking over the agent will not interrupt it — a tap on
the voice bar does. Everything else behaves as it does on the web.

## What to send back

Just confirmation that the two permissions and the global are in a build, and
which build it is. We will enable the same thing on production so the live app
picks it up.

Full WebView contract, including sign-in, payment return and receipt printing:
`docs/MOBILE-APP-WEBVIEW-CONTRACT-2026-09-17.md` (shared 17 September).
