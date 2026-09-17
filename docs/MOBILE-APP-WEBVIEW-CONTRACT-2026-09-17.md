# What the Emirates Post app needs to give the chat

For the mobile team, from the NXN PO Box Agent mobile bug list (11 September).

Twelve of the fifteen items are fixed in the widget and need nothing from the
app. Four of them are only *half* fixable from the web side, because they turn
on things a WebView alone cannot do: sign a customer in, dismiss a browser the
OS put in front of the app, or open a microphone. This is the whole list of what
the app has to provide, and none of it is more than a few lines.

The channel already exists and is the one the widget has always used: the app
sets a global on the page before our scripts run, and the widget posts messages
back through `window.ReactNativeWebView.postMessage`.

---

## 1. Sign-in — issues 3 and 10

**Reported:** "login is not redirecting back to the chat screen; the app lands on
the account home screen instead of returning to the chat", and "refreshing the
chat window prompts the user to sign in again."

Both are the same thing. Today the chat's sign-in button opens the portal in an
in-app browser. The customer signs in *there*, that browser returns *there*, and
the conversation is left behind. No amount of care inside the WebView can change
where a separate browser goes next.

**What the app does instead.** The app already holds the customer's session. It
exchanges that token with us from native code and hands the page a short-lived
code — never the token itself:

```
POST https://<host>/api/embed/handoff
Content-Type: application/json

{ "agent": "nxn-dialog", "token": "<the customer's Emirates Post session token>" }

→ 200 { "ok": true, "handoff": "<code>", "conversationId": "…", "expiresIn": 120 }
```

Then, **before the page's own scripts run**:

```js
window.__dialogNativeHandoff = "<code>";
```

The code is worth two minutes, is single-use, and names a conversation and
nothing else — it is worthless to anyone who intercepts it. The real token stays
in the app and on our server, encrypted against the conversation. It is never a
query parameter, because a token in a URL is written to the access log and kept
in the WebView's history.

**And when the chat asks.** The widget now posts this when the customer taps
sign-in, and when they start a new chat:

```json
{ "source": "dialog-native", "action": "signin-needed", "reason": "customer-asked" | "new-chat" }
```

Answer it by minting a fresh code and injecting:

```js
window.dispatchEvent(new CustomEvent("dialog-native", {
  detail: { action: "handoff", handoff: "<a new code>" }
}));
```

`reason: "new-chat"` is issue 10 exactly. A native session lives against the
conversation on our server and the code is single-use, so starting a new
conversation genuinely leaves the identity behind — there is nothing in the page
to carry forward. The widget keeps the header saying "signed in" for five
seconds while it waits for an answer; after that it shows them signed out,
because that will be the truth.

Ignoring these messages costs nothing: the widget still falls back to opening the
portal, exactly as it does today.

---

## 2. The microphone — issue 11

**Reported:** "Major — the app crashed on clicking the speak (microphone) icon."

Not a crash in the page. The screenshot is iOS reporting that *(QA)Emirates Post*
crashed, which is what the OS does to a process that reaches for the microphone
with no `NSMicrophoneUsageDescription` in its `Info.plist`.

`navigator.mediaDevices.getUserMedia` exists in a WKWebView whether or not the
app around it is permitted to record, so the feature test the mic button used
could not tell the difference — the page found out by taking the app down.

**The mic is now off inside a native host by default.** To turn it on, once the
app has both the usage description and a WebView delegate that grants the
permission:

```js
window.__dialogNativeVoice = true;   // before the page's scripts run
```

Until then the button is simply not there, which is better than a button that
ends the session.

---

## 3. Coming back from payment — issue 8

**Reported:** "after completing payment, the app does not automatically redirect
back to the chat window; it stays on the 'Payment window — Returning you to the
chat…' screen."

The payment page opens in an in-app browser (`SFSafariViewController`) presented
over the WebView. It is not a window anything opened, so it has no `opener` to
post back to and `window.close()` does nothing.

**Already handled without you.** The WebView underneath is hidden while that
browser is in front of it and visible again the moment it goes away, and the chat
now reads that as the customer coming back. So dismissing the browser by hand
already returns them to a conversation that picks the payment up. The return page
also stops promising a return it cannot make and offers a button after two
seconds.

**Two optional improvements, if you want it to close by itself:**

- Give us the app's URL scheme (e.g. `emiratespost://…`). We set it as
  `NATIVE_RETURN_URL` and the return page navigates there, which makes iOS
  dismiss the browser and hand control back to the app.
- Or open payment links in a WebView of your own rather than the system browser,
  and listen for
  `{ "source": "dialog-native", "action": "returned" }`.

The widget tells you when it opens one, so you always know which is which:

```json
{ "source": "dialog-native", "action": "open-url", "kind": "payment" | "signin", "url": "…" }
```

---

## 4. Saving the receipt — issue 9

**Reported:** "'Print / Save as PDF' is not functional on the payment receipt
screen."

`window.print()` is ignored in an in-app browser and there is no way for a page
to open the OS print sheet itself. The receipt now checks whether a sheet
actually opened and, when it did not, tells the customer to use the browser's
share button — which works today.

If you would rather raise your own share sheet, the button posts:

```json
{ "source": "dialog-native", "action": "print", "url": "<the receipt URL>" }
```

---

## Everything else the widget already posts

For completeness — all of these are one-way and safe to ignore:

| message | when |
|---|---|
| `{ action: "open-url", kind, url }` | payment page, host sign-in or UAE PASS is being opened |
| `{ action: "signin-needed", reason }` | the customer asked to sign in, or started a new chat |
| `{ action: "signed-out" }` | they signed out, or withdrew permission |
| `{ action: "completed", reference, journey }` | a request was submitted |
| `{ action: "print", url }` | they asked to save a receipt |

And the two events the app can send in:

| event | meaning |
|---|---|
| `{ action: "handoff", handoff }` | here is a sign-in code |
| `{ action: "returned" }` / `{ action: "closed" }` | the customer is back from a page you opened |

Sent by dispatching a `dialog-native` CustomEvent on `window` from
`injectJavaScript`, which is the only channel a WebView has into the page.
