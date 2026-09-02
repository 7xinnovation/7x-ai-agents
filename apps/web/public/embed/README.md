# Dialog assistant in a React Native app

A WebView wrapper around the widget the website already runs. **Not a second
chat**: the same conversation, journeys and fixes, loaded from the same URL, so
nothing here has to be kept in step with the web build.

Copy `DialogChat.tsx` into the app and render it.

```bash
npx expo install react-native-webview expo-web-browser
# bare RN: npm i react-native-webview expo-web-browser && npx pod-install
```

```tsx
import { DialogChat } from "./DialogChat";

<DialogChat
  host="https://agent.7x.ae"
  agent="nxn-dialog"
  locale="en"
  accessToken={session.accessToken}
/>
```

## Props

| Prop | Required | What it is |
|---|---|---|
| `host` | yes | Where the assistant is hosted. Staging `https://7xagents.7x-lab.com`, production `https://agent.7x.ae`. |
| `agent` | yes | `nxn-dialog`. |
| `locale` | no | `en` or `ar`. Defaults to the agent's first locale. |
| `accessToken` | no | The customer's Emirates Post access token. Pass it and the conversation starts signed in; leave it out and they are a guest, which is a supported path. |
| `conversationId` | no | Resume a conversation they already had. |
| `onCompleted` | no | Called with the reference when a purchase completes. |

## What the wrapper is actually for

The conversation opens a payment page, a sign-in page and a file picker. A
WebView answers `window.open` with null, and the widget's browser fallback would
replace the conversation with a payment page and leave no way back to it.

So the page posts `{ source: "dialog-native", action: "open-url", url }`, the
wrapper opens it in an in-app browser, and when that closes it dispatches a
`dialog-native` event back into the page. The conversation then asks the backend
whether the money arrived — it never assumes, and neither should the wrapper.

Anything that is not the assistant's own origin opens outside the WebView too.
Navigating away from it loses the conversation, which is the one thing that must
not happen.

## Permissions

The conversation can pin an address on a map and take a spoken message. Without
these it degrades — the customer types the address instead — rather than failing.

**iOS** (`Info.plist`)
```
NSLocationWhenInUseUsageDescription   Used to pin your delivery address.
NSMicrophoneUsageDescription          Used to send a spoken message.
NSCameraUsageDescription              Used to photograph a document.
NSPhotoLibraryUsageDescription        Used to attach a document.
```

**Android** (`AndroidManifest.xml`)
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
```

## Checking it works

Nothing about the conversation itself needs testing here — it is the web widget.
What is worth walking once on a device:

1. **Signed in.** Pass `accessToken` and open it: the assistant should greet the
   customer by name and know their boxes. If it treats them as a guest, the token
   did not arrive.
2. **A payment.** Reach the payment card and tap it. An in-app browser should
   open over the app; closing it should return to the conversation, which then
   confirms or says the payment has not come through. It must never leave the
   customer on a payment page with no way back.
3. **An address.** Ask for a MyHome box: the map should open and the pin should
   resolve to a real area.
4. **A document.** Upload a trade licence on the corporate journey — the file
   picker is the Android-specific one.
5. **Arabic.** `locale="ar"` — the whole conversation, including the map picker
   and the payment card, is translated.

## Host allow-list

The embed page sets `frame-ancestors`, which does not apply to a WebView, so
nothing needs adding for the app. The `accessToken` travels as a query parameter
to our origin over TLS and is not persisted by the wrapper.
