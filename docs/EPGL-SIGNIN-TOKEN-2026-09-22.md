# EPGL sign-in handover — what we need

So a customer already signed in on `app.epgl.ae` is recognised by the assistant
without signing in again. Three things from you, one from us.

---

## 1. Sign a JWT

Any of RS256 / ES256 / HS256 (and the 384/512 variants). In Apex,
`Crypto.signWithCertificate('RSA-SHA256', ...)` with a self-signed certificate
from **Setup → Certificate and Key Management** gives RS256, which is what we'd
suggest — we then only ever hold the public half.

Claims:

| Claim | Value |
|---|---|
| `sub` | **Required.** The UAE PASS subject of the signed-in user. Stable across sessions. |
| `emiratesId` | The customer's Emirates ID. UAE PASS returns it as `idn`. |
| `iss` | `epgl.ae` |
| `aud` | `7x-dialog` |
| `iat` / `exp` | Issued-at and expiry. 15 minutes is fine — refresh before it lapses. |

`emiratesId` is optional but worth including: with it we read the customer's
trade licences straight from the registry and they confirm one. Without it they
sign in and then type their Emirates ID by hand.

**Three things that fail silently:**

- **base64url, not base64.** `EncodingUtil.base64Encode` alone will not work —
  append `.replace('+','-').replace('/','_').replace('=','')`.
- **No `sub`, no sign-in.** A valid signature that identifies nobody is refused.
- **Refresh before `exp`.** An expired token keeps being sent and keeps being
  rejected.

---

## 2. Put it in `localStorage`, and name the key

A small LWC on the logged-in pages writes it:

```js
localStorage.setItem('epglDialogToken', jwt);
```

Then tell the relay which key to read — this is the only change to the script
tag you have already added:

```html
<script src="https://agent.7x.ae/dialog-relay.js"
        data-domain=".epgl.ae"
        data-token-key="epglDialogToken"></script>
```

The relay does the rest. No other front-end work.

---

## 3. Send us the public certificate

Download it from Setup → Certificate and Key Management and send us the PEM. We
install it against `iss = epgl.ae` and `aud = 7x-dialog`, and that is our whole
side of the job.

Until we have it, every token is rejected — verification fails closed, so there
is nothing to test before this step.

---

## One note on staging

Both `/s/login-epgl` and `/s/login/` currently load the **production** relay,
`https://agent.7x.ae/dialog-relay.js`. The relay hands the token only to the
origin that served it, so a token minted on the staging login page goes to
production and the staging assistant never sees it.

For staging testing, `/s/login-epgl` needs the staging script instead:

```html
<script src="https://7xagents.7x-lab.com/dialog-relay.js"
        data-domain=".epgl.ae"
        data-token-key="epglDialogToken"></script>
```

Production works either way.
