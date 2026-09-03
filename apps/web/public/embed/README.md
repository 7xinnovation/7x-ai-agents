# Emirates Post assistant — mobile app integration

**For the mobile developer.** Everything you need to put the PO Box assistant
inside the Emirates Post app.

Read this first, because it decides how much work this is: **you are not
building a chat.** The assistant is a web app we host and maintain. Your job is
to show it in a WebView and handle the four things a WebView cannot do by
itself. There is no chat UI to build, no message list, no API to call, no state
to keep. When we ship a fix, the app gets it without a release.

The whole integration is one file — `DialogChat.tsx` — plus permissions.

---

## 1. Install

```bash
# Expo
npx expo install react-native-webview expo-web-browser

# bare React Native
npm i react-native-webview expo-web-browser && npx pod-install
```

Copy `DialogChat.tsx` into the project. Don't edit it — see §7 if something
doesn't fit.

## 2. Render it

It fills its parent, so give it a screen or a sheet, not a small box. The
conversation includes a map picker and a payment card and needs the room.

```tsx
import { DialogChat } from "./DialogChat";

export function AssistantScreen() {
  return (
    <DialogChat
      host="https://7xagents.7x-lab.com"     // staging; see §3
      agent="nxn-dialog"
      locale="en"
      accessToken={session.accessToken}
      onCompleted={(reference) => {
        // Optional. Fired once, when a request is actually recorded.
      }}
    />
  );
}
```

That is the integration. The rest of this document is the detail behind it.

## 3. Props

| Prop | Required | What it is |
|---|---|---|
| `host` | **yes** | Staging `https://7xagents.7x-lab.com` · Production `https://agent.7x.ae` |
| `agent` | **yes** | `nxn-dialog` |
| `accessToken` | no, but see below | The customer's Emirates Post access token |
| `locale` | no | `"en"` or `"ar"` |
| `conversationId` | no | Resume a conversation the customer already had |
| `onCompleted` | no | `(reference: string) => void`, once per completed request |
| `style` | no | Merged over `flex: 1` |

### `accessToken` — the one thing only you can supply

This is the **same token your app already uses for Emirates Post API calls** —
the one their identity service returns after UAE PASS sign-in. Not a UAE PASS
token, not an ID token, not something new we need issued.

Pass it and the conversation opens signed in: the assistant greets the customer
by name, already knows their PO Boxes, their saved card and their contact
details, and can renew without asking for a box number.

Leave it out and the customer is a **guest**. That is a supported path, not a
failure — they can still rent and renew, they just type more. So if sign-in is
optional in your app, pass the token when you have one and nothing when you
don't. Don't block the screen waiting for a token.

If it expires mid-conversation the assistant falls back to guest behaviour and
asks the customer to sign in. Re-mounting with a fresh token is enough; there is
nothing to refresh on our side.

**How it is handed over, since this is the obvious thing to worry about.** The
token is injected into the page's memory before its own scripts run
(`injectedJavaScriptBeforeContentLoaded`). It is **not** a query parameter and
not a header:

- Not in the URL, so it is never written to a server access log, never kept in
  the WebView's back/forward history, and never restored with its saved state.
- Not persisted by the wrapper — no `AsyncStorage`, no cookie, no disk. It lives
  in the JS context and dies with the WebView.
- Only ever sent to your own `host` origin, over TLS. `originWhitelist` pins the
  WebView to that origin, and anything else opens in an external browser.
- Verified **server-side** before the customer is treated as signed in. A bad or
  expired token leaves them a guest — never half signed in.

Two things that remain yours: keep the token wherever your app already keeps it
(Keychain / Keystore, not `AsyncStorage`), and don't log the props you pass to
this component.

## 4. Permissions — do this, or steps silently degrade

The conversation can pin a delivery address on a map, take a spoken message, and
photograph a document. Missing permissions don't crash it; the customer just
types their address instead, which is a worse experience nobody will report as a
bug.

**iOS — `Info.plist`**
```
NSLocationWhenInUseUsageDescription   Used to pin your delivery address.
NSMicrophoneUsageDescription          Used to send a spoken message.
NSCameraUsageDescription              Used to photograph a document.
NSPhotoLibraryUsageDescription        Used to attach a document.
```

**Android — `AndroidManifest.xml`**
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
```

## 5. What the wrapper is actually doing

Four moments in the conversation open a page that isn't ours: **our payment
page**, **Emirates Post's payment page**, **the host sign-in**, and **UAE PASS**.

On the web these are `window.open`. In a WebView `window.open` returns `null`,
and the naive fallback — navigating the WebView itself — replaces the
conversation with a payment page and leaves the customer no way back to it. They
have paid and have nowhere to return to. That is the failure this wrapper exists
to prevent.

So the flow is:

```
page  →  postMessage { source: "dialog-native", action: "open-url", url }
you   →  WebBrowser.openBrowserAsync(url)          in-app browser, over the app
you   →  injectJavaScript → window 'dialog-native' event { action: "returned" }
page  →  asks OUR BACKEND whether the payment actually landed
```

Two things follow from that last line, and both matter:

- **Closing the browser does not mean they paid.** The wrapper never decides
  this, and neither should you. The conversation asks the backend, which is the
  only thing that knows. Don't add logic that treats dismissal as success — or
  as failure.
- **`onCompleted` fires from the backend's answer**, not from the browser
  closing. It is the only signal worth acting on, and it carries the reference
  number.

Anything that isn't our origin also opens outside the WebView, for the same
reason: navigating away loses the conversation.

`setSupportMultipleWindows={false}` is deliberate. It is what makes the page ask
you instead of opening a second WebView you don't control. Don't turn it on.

## 6. Testing on a device

The conversation itself needs no testing — it's the same web widget already live
on emiratespost.ae. What's worth walking once, on a real device, is the seam
between it and your app:

1. **Signed in.** Pass `accessToken`. The assistant should greet the customer by
   name and list their boxes. If it treats them as a guest, the token didn't
   arrive — check it's the Emirates Post access token and not a UAE PASS one.
2. **A payment.** Reach the payment card and tap it. An in-app browser opens
   over the app; closing it returns to the conversation, which then confirms the
   payment or says it hasn't come through. It must never strand the customer.
3. **An address.** Ask for a MyHome box. The map opens, the pin resolves to a
   real area. Test with location permission **denied** too — it should fall back
   to search, not break.
4. **A document.** Upload a trade licence on the corporate journey. The Android
   file picker is the one to watch.
5. **Arabic.** `locale="ar"`. The whole conversation flips, including the map
   and the payment card.
6. **Android back button.** It should walk back through the conversation before
   leaving the screen.

## 7. If something doesn't fit

Tell us rather than editing `DialogChat.tsx`. The file is generated from our
side and will be re-issued; local edits get lost, and most needs are better met
by a change to the page than to the wrapper. The one exception is styling the
container, which is what `style` is for.

## 8. What is NOT your responsibility

Listed because it's the usual source of doubled-up work:

- The chat UI, message history, typing indicators, retries
- Any Emirates Post API call — rentals, renewals, pricing, payments
- Payment handling beyond opening a URL and reporting that it closed
- Uploading documents, or storing them
- Translation, RTL layout, the map, the address list
- Anything conversational

If a requirement sounds like one of these, it's ours. Send it over.

## 9. Known gaps, honestly

- **Not yet run on a physical device by us.** Everything above is built and
  builds clean, but the device pass in §6 has not been done. Expect the first
  run to surface something, most likely in the Android file picker.
- **No push notification hook.** If a request completes after the customer has
  closed the screen, nothing notifies them. `onCompleted` only fires while the
  screen is mounted. Tell us if you need this and we'll add it.
- **No deep link back into a conversation.** `conversationId` resumes one if you
  store it; there is no URL scheme yet.

## 10. Who to ask

Send questions with a screenshot and, if you can, the `conversationId` — it
appears in the widget's URL and lets us pull the exact conversation server-side.
