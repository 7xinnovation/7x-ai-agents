# Putting the assistant on a page

Two ways. The first is one line and we own the sizing. The second is an iframe
you place yourself, and then the sizing is yours — which is where the widget
stops fitting.

## If the panel does not fit

Run this in the console on the page that is embedding it:

```js
window.Dialog.diagnose()
```

It returns what the panel actually is — its rectangle, its computed size, the
window it is in, whether it is clipped on any edge, and the loader version. Send
that object over; it settles in one go what a screenshot cannot.

The field worth reading first is **`fixedPositioningBrokenBy`**. The panel is
`position: fixed`, which is measured against the window — *unless* some ancestor
has a `transform`, `filter`, `perspective` or `contain: paint`, in which case the
browser measures against that element instead and the panel is moved and clipped
by it. Nothing in our stylesheet can reach that; it has to be fixed on the host
page, usually by not transforming a wrapper that spans the whole document. If
that field names an element, that element is the problem.

## 1. The loader (recommended)

```html
<script
  src="https://agent.7x.ae/dialog.js"
  data-agent="nxn-dialog"
  data-host="https://agent.7x.ae"
  defer></script>
```

That is the whole integration.

### Language

**Leave `data-locale` off and the widget follows the page.** It reads
`<html lang>` at load: `lang="ar"` opens the assistant in Arabic, `lang="en"` in
English. Regional tags work too — `ar-AE`, `en-GB` — and so does any casing.

That means the Arabic site needs no different snippet from the English one: the
same tag on both, and the assistant matches whichever page the reader is on.

Set `data-locale="ar"` (or `"en"`) only to override the page — it wins over
`<html lang>`, which is what you want if the widget should stay in one language
regardless. Anything unrecognised falls back to English.

It also **follows a switch made without reloading**. A toggle that swaps
`<html lang>` in place is watched, and the panel changes language where it
stands — the conversation in it is kept, because swapping the language by
discarding what the customer has typed is not switching language, it is
starting again. The script creates its own launcher and panel,
positions them, and sizes them against the window:

| | |
|---|---|
| Panel | 404 × 640, capped at `100dvh − 112px` tall and `100vw − 32px` wide |
| Position | 24px from the bottom and side; the panel sits 72px above the launcher |
| Narrow or short screens | Full-screen below 640px wide **or** 520px tall |

Because the cap is a `max-height`, the panel can never be taller than the window
it is in. Nothing on the host page needs to change when we adjust it — the file
is served from us.

Optional attributes: `data-position="bottom-left"`, `data-offset-bottom="88"`,
`data-offset-side="16"` (pixels, 0–400). Use these when a page already has
something in that corner — a cookie bar, an accessibility button — rather than
wrapping the widget in your own container.

## 2. Your own iframe

If the widget has to live inside your own layout, embed the page directly:

```html
<iframe
  src="https://agent.7x.ae/embed/nxn-dialog?locale=en"
  title="Emirates Post assistant"
  allow="clipboard-write; microphone"
  style="border:0; width:404px; height:640px; max-width:calc(100vw - 32px); max-height:calc(100dvh - 112px);"
></iframe>
```

**The two `max-*` lines are the ones that matter.** Without them the iframe is
whatever height you gave it, and if that is taller than the window the browser
clips it — from the TOP, because the panel is anchored to the bottom. What
disappears is the header: the logo, the language switch and the sign-in button.
The conversation below still works, which is what makes it easy to miss.

Inside the iframe our layout fills whatever space it is given. It cannot tell
how much of that space is actually on screen — a cross-origin frame cannot see
its parent's viewport — so an iframe taller than the window is only fixable on
the page that sizes it.

### Telling which one you have

Open the page and inspect the frame:

- A `<div class="dlg-frame widget">` or `<iframe class="dlg-frame widget">` means
  our loader is in charge, and any sizing problem is ours to fix.
- A bare `<iframe>` with your own class or inline height means it is yours.

A quick check from the console. **Measure `.dlg-frame`, never `iframe`** — the
loader also creates a hidden 0x0 bridge frame, and it is appended first, so
`document.querySelector('iframe')` usually returns that one and tells you
nothing:

```js
const f = document.querySelector('.dlg-frame');   // ours if this is an element
const s = getComputedStyle(f);
({
  version: window.Dialog?.version,                 // the loader you are running
  rect: f.getBoundingClientRect().toJSON(),        // where it actually is
  height: s.height, maxHeight: s.maxHeight,
  window: [innerWidth, innerHeight],
  clippedAtTop: f.getBoundingClientRect().top < 0, // the header is off-screen
})
```

`clippedAtTop: true` means the panel is taller than the space above the
launcher. Since the loader sizes it inline against the window on every resize,
that should not happen — if it does, send this object over.

## Signing a customer in

The host page owns UAE PASS. Hand us the token and we verify it server-side
before the widget shows anyone as signed in:

```js
window.Dialog.setUaePassToken(token);
```

The loader also picks it up from `localStorage` if you write it there, and
re-offers it if it changes. When the customer signs out inside the widget it
posts `{ source: "dialog", action: "signed-out" }` to the parent, and it will
refuse the host's token until they ask to sign in again — so drop your copy when
you see that message.
