# Signing out ends the UAE PASS session — 12 October 2026

Raised as a security issue: "the UAE PASS session must be killed at sign out."
This note says what was wrong, what changed, how to check it, and the one part
that is the mobile app's to do.

## What was wrong

Signing out of the assistant ended our own session and was meant to end the
UAE PASS single sign-on too, by opening a small window on UAE PASS's logout.
Three things made that unreliable:

1. **The window opened too late.** It was opened only after the request that
   ends our own session had been awaited. Chrome tolerates that; Safari and
   iOS do not count it as part of the tap, so there the window was blocked and
   nothing reached UAE PASS.
2. **UAE PASS was the last hop.** The window went to the portal first (up to
   eight seconds), then the portal's logout page (two seconds), and only then
   to UAE PASS — up to ten seconds after the tap. A customer who closed the
   window or the tab in that time kept their single sign-on.
3. **The window was closed on a 3.5-second timer**, which could cut UAE PASS's
   own redirect chain short on a slow connection.

The "ask again next time" (`prompt=login`) that backs all this lived in memory
on the page, so a reload or a new tab forgot it.

## What changed

- **The window opens synchronously in the click**, before anything is awaited,
  and it opens on **UAE PASS's logout first**. Our own session is ended with a
  `keepalive` request alongside it.
- **The end of UAE PASS's chain is observed, not guessed.** Their chain returns
  to our `/uaepass/done` (followed with curl against both environments on
  12 October: `idshub/logout` → `commonauth` → `digitalid-idp/logout` → our
  page, 200). That page now tells the window that opened it, and the widget
  moves on the moment it hears — or after eight seconds if it never does. Only
  then does the same window go to the portal's sign-out (relay, `dlg-signout`),
  the portal's logout page where there is one, and close.
- **If no window can open** (pop-ups blocked) and the widget is a tab of its own
  rather than a frame, the tab itself goes to UAE PASS's logout and
  `/uaepass/done` brings it back to the chat, signed out. In a frame the widget
  says so in the console and the server's belt below covers the next sign-in.
- **A server-side belt.** Both sign-out routes set an HttpOnly cookie
  `uaepass_relogin=1` for a day; `/api/uaepass/login` sends `prompt=login` to
  UAE PASS whenever it is present; a completed sign-in deletes it. A reload, a
  new tab or a blocked window no longer loses the "ask again".
- **The app is told where the logout is.** The `signed-out` message to the
  native host now carries `uaePassLogoutUrl` (see below).

Nothing in the sign-in path changed. First sign-ins still get single sign-on.

## How to check it

In a browser, signed in through UAE PASS:

1. Sign out from the profile menu. A small window opens on UAE PASS and closes
   itself; the console shows `[dialog] UAE PASS session ended (reported by
   /uaepass/done).`
2. Tap **Sign in**. UAE PASS asks for the phone number again rather than
   signing straight back in.
3. Open a new tab on the chat before tapping Sign in: the same — the cookie
   carries the "ask again" across tabs.

With pop-ups blocked (Safari's default for windows opened late is exactly this
case), step 1 instead takes the whole tab to UAE PASS and back, signed out.

`apps/web/scripts/test-uaepass-signout-2026-10-12.ts` pins the shape of all of
this (22 checks), beside the three older sign-out suites.

## The mobile app's half

Inside the Emirates Post app the widget cannot open windows: `openExternal`
posts `{ action: "open-url", kind: "signout", url }` to the host, and the
`signed-out` message now also carries `uaePassLogoutUrl`. The app signed the
customer in with its own browser session, and only the app can end it: on
`signed-out`, open `uaePassLogoutUrl` in the same browser context it used for
sign-in (the authentication session, not a plain web view), and drop the token
it holds. The next sign-in it starts will then ask UAE PASS again.

## Still open

- Registering `https://agent.7x.ae/uaepass/done` (and the staging equivalent)
  as a post-logout redirect URI with UAE PASS, through Emirates Post, so a
  live session is always returned to our page rather than the portal's.
