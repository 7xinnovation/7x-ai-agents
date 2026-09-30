# Signing out of the assistant has to sign out of box.emiratespost.ae too

For whoever maintains the script tag on `box.emiratespost.ae`.
One attribute. No other change.

## What happens today

The customer clicks their profile icon in the assistant and signs out. Our side
does everything it can: the conversation's session ends, our mirror cookie is
deleted, and the assistant shows a signed-out widget.

Then they click **Sign in** and they are signed straight back in, as the same
person, without UAE PASS asking anything.

That is not a bug in the sign-out. It is the relay doing exactly what it was
installed to do. The token in this site's `localStorage` is **your** session,
not ours, and the relay was deliberately written never to delete it — deleting
it signs the customer out of box.emiratespost.ae, and that is the site owner's
decision to make, not a side effect of embedding a chat widget.

So the sequence is: we clear our copy, the relay finds your token still there
two seconds later, and hands it back. There is no version of this we can fix
from our end without making that decision on your behalf.

## Why it can only be fixed there

Your session is entirely client-side. Reading your own bundle:

```
localStorage.setItem("accessToken", ...)   // the session
localStorage.setItem("profile", ...)       // the name on the dashboard
```

There is no cookie and nothing server-side to expire. Only script running on
`box.emiratespost.ae` can remove those, and the only script we have there is the
relay you already inject from `_app`:

```js
let e = "https://agent.7x.ae/dialog-relay.js";
if (!document.querySelector(`script[src="${e}"]`)) {
  let t = document.createElement("script");
  t.setAttribute("src", e);
  t.setAttribute("data-domain", ".emiratespost.ae");
  (document.body || document.head).appendChild(t);
}
```

It is loading and working — that is how the assistant sees the customer as
signed in. It refuses to delete the token because we wrote it to refuse, and it
prints the reason in the console every time somebody signs out.

## The change

Two attributes on that same tag:

```js
  t.setAttribute("src", e);
  t.setAttribute("data-domain", ".emiratespost.ae");
  t.setAttribute("data-signout-clears-host", "1");
  t.setAttribute("data-signout-clears-keys", "accessToken,profile");
```

`accessToken` is the session. `profile` is only the name, but a dashboard still
saying "Welcome EMRE!" after a sign-out reads as a sign-out that did not work,
so it goes with it.

Nothing else changes, and the same two lines apply on `box-stg`.

## It works whether the chat is embedded or opened on its own

Worth knowing, because it caught us out. The assistant announces a sign-out by
posting a message to the page it is embedded in — which reaches the relay only
when the chat is an iframe on your site. Opened on its own at
`agent.7x.ae/embed/nxn-dialog`, there is no page of yours in the frame tree and
the message reaches nothing.

So as of today the assistant also opens a short-lived window on
`https://box.emiratespost.ae/?dlg-signout=1` when it signs somebody out. The
relay is on that page like it is on every page, sees the marker, ends the
session and the window closes itself. The window is a blank moment, nothing is
rendered in it, and it is not a sign-in page — pointing a sign-out at
`/uaepass` would simply sign the customer back in.

Both routes are under the same attribute. Without it, both do nothing.

## Checking it worked

Console on box.emiratespost.ae, before the change, right after a sign-out:

```
[dialog-relay] the assistant signed out and our cookie is cleared, but this
site's own token in "accessToken" was left alone. Add
data-signout-clears-host="1" to also sign the customer out of this site.
```

After the change that line is gone, and both
`localStorage.getItem('accessToken')` and `localStorage.getItem('profile')`
return `null`.

The assistant's own console also says so, from its side:

```
[dialog] https://box.emiratespost.ae was asked to sign out and declined:
the relay tag there needs data-signout-clears-host="1".
```

That line appearing means the window opened and the tag has not been updated
yet. Its absence, plus a Sign in that goes to UAE PASS and asks for the phone
number, is the whole test.
