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

## The change

Add `data-signout-clears-host="1"` to the existing tag:

```html
<script src="https://agent.7x.ae/dialog-relay.js"
        data-domain=".emiratespost.ae"
        data-token-key="accessToken"
        data-signout-clears-host="1"></script>
```

Keep `data-token-key` and `data-domain` exactly as they are now — only the new
attribute is being added. Staging is the same tag with
`https://7xagents.7x-lab.com/dialog-relay.js`.

With it set, a sign-out in the assistant removes the token from this site's
`localStorage` as well. The next **Sign in** has nothing to resume, so it goes
to UAE PASS and asks properly.

## What it means

One identity, one sign-out. A customer who signs out of the assistant is signed
out of box.emiratespost.ae as well and will need to sign in again to use the
rest of the site. We think that is the right behaviour and it is what the
customer expects from a sign-out — but it is a real change to this site's
session handling, which is why it is opt-in rather than something we switched on
ourselves.

If you would rather it did not, the alternative is that the assistant's sign-out
stays cosmetic while this site holds a session — and "sign out" then means
"clear the chat", which we would want to relabel.

## Checking it worked

Console on box.emiratespost.ae, before the change, right after a sign-out:

```
[dialog-relay] the assistant signed out and our cookie is cleared, but this
site's own token in "accessToken" was left alone. Add
data-signout-clears-host="1" to also sign the customer out of this site.
```

After the change that line is gone, and `localStorage.getItem('accessToken')`
returns `null`.
