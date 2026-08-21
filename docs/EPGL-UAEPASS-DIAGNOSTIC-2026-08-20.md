# EPGL — UAE PASS sign-in: what is failing and what we need

**Date:** 20 August 2026
**Author:** 7X (Dialog Platform / EPGL agent)
**Audience:** Emirates Post Group Licensing development team, Salesforce team

---

## Summary

UAE PASS sign-in from the embedded EPGL agent fails, and it fails for **two different
reasons** in staging and production. Neither is a fault in our request.

| Environment | Client id | UAE PASS response | Meaning |
|---|---|---|---|
| Staging | `epg_web_stage` | `invalid_client` / `application.not.found` | The application is not provisioned on the UAE PASS staging IdP |
| Production | `epg_web_prod` | `invalid_callback` / `callback.not.match` | The application exists; the redirect URI we were given is not the one registered |

Everything below is reproducible with `curl` — please run it yourself rather than
taking our word for it.

---

## What we are sending

A standard OIDC authorisation-code request, per the UAE PASS documentation:

| Parameter | Value |
|---|---|
| `response_type` | `code` |
| `scope` | `urn:uae:digitalid:profile:general` |
| `acr_values` | `urn:safelayer:tws:policies:authentication:level:low` |
| `ui_locales` | `en` |
| `client_id` | `epg_web_stage` (staging) / `epg_web_prod` (production) |
| `redirect_uri` | as supplied to us — see below |

Endpoints: `https://stg-id.uaepass.ae` (staging) and `https://id.uaepass.ae`
(production), paths `/idshub/authorize`, `/idshub/token`, `/idshub/userinfo`.

### Note on `/idshub/authorize` — why this looks like it works

`/idshub/authorize` is a pass-through. It returns `302` and forwards **any**
`client_id`, including one that does not exist. Validation happens at the next hop,
`{stg-}ids.uaepass.ae/oauth2/authorize`. Testing against `/idshub/authorize` alone
will suggest the integration is fine when it is not — this is worth knowing if
anyone has already "verified" the client that way.

---

## Staging: the application is not registered

```bash
curl -s -o /dev/null -w '%{redirect_url}\n' \
 "https://stg-ids.uaepass.ae/oauth2/authorize?ui_locales=en\
&scope=urn%3Auae%3Adigitalid%3Aprofile%3Ageneral\
&acr_values=urn%3Asafelayer%3Atws%3Apolicies%3Aauthentication%3Alevel%3Alow\
&response_type=code&state=probe\
&redirect_uri=https%3A%2F%2Fepro--preprod2.sandbox.my.site.com\
&client_id=epg_web_stage"
```

Result:

```
https://stg-ids.uaepass.ae:443/authenticationendpoint/oauth2_error.do
  ?oauthErrorCode=invalid_client&oauthErrorMsg=application.not.found
```

### Two controls, same request, only `client_id` changed

| `client_id` | Result |
|---|---|
| `epg_web_stage` | `invalid_client` / **`application.not.found`** |
| `epg_retail_web_stage` | `invalid_callback` / `callback.not.match` |
| `sandbox_stage` (UAE PASS public sandbox client) | **reaches the UAE PASS login page** |

These controls are what make the conclusion firm:

- `sandbox_stage` reaching the login page proves our endpoint, scope, `acr_values`
  and overall request shape are correct.
- `epg_retail_web_stage` returning `callback.not.match` proves that a client which
  **does** exist but lacks our redirect URI produces a *different* error.

Therefore `application.not.found` for `epg_web_stage` is neither a callback problem
nor a malformed request. **The client does not exist on the UAE PASS staging IdP.**

We are aware `epg_web_stage` appears in the UAE PASS credentials document. Being
listed in that document is not the same as being provisioned on the IdP, and the
IdP is the authority here.

**What we need:** `epg_web_stage` provisioned on UAE PASS staging — or, if a
different client id is the one actually registered for staging, that id.

---

## Production: the application exists, the callback does not match

```bash
curl -s -o /dev/null -w '%{redirect_url}\n' \
 "https://ids.uaepass.ae/oauth2/authorize?ui_locales=en\
&scope=urn%3Auae%3Adigitalid%3Aprofile%3Ageneral\
&acr_values=urn%3Asafelayer%3Atws%3Apolicies%3Aauthentication%3Alevel%3Alow\
&response_type=code&state=probe\
&redirect_uri=https%3A%2F%2Fapp.epgl.ae\
&client_id=epg_web_prod"
```

Result:

```
oauthErrorCode=invalid_callback&oauthErrorMsg=callback.not.match
```

`callback.not.match` rather than `application.not.found` means **the client is
registered** — only the redirect URI is wrong. But `https://app.epgl.ae` is the
production redirect URI we were given. We tried the obvious variants and all were
rejected:

| `redirect_uri` tried | Result |
|---|---|
| `https://app.epgl.ae` | `callback.not.match` |
| `https://app.epgl.ae/` | `callback.not.match` |
| `https://app.epgl.ae/services/authcallback/UAEPASS` | `callback.not.match` |
| `https://app.epgl.ae/uaepass/callback` | `callback.not.match` |
| `https://epgl.ae` | `callback.not.match` |
| `https://www.epgl.ae` | `callback.not.match` |

`epg_retail_web_prod` behaves identically against `https://app.epgl.ae`.

**What we need:** the exact registered `redirect_uri` for `epg_web_prod`, character
for character. UAE PASS matches it exactly — a trailing slash or a differing path
is enough to fail.

---

## What we need registered

Our callback endpoints, to be added to the UAE PASS client registrations:

| Environment | Redirect URI |
|---|---|
| Staging | `https://7xagents.7x-lab.com/api/uaepass/callback` |
| Production | `https://agent.7x.ae/api/uaepass/callback` |

---

## Alternative: skip UAE PASS registration entirely

There may be no need for any of the above.

If the EPGL widget is embedded on `app.epgl.ae`, the customer has **already signed
in with UAE PASS on that page**. We do not need to run our own UAE PASS flow — we
need the session that sign-in produced. Our embed loader runs as a first-party
script on the host page, so it can read the token from `localStorage` and hand it to
the agent, which then validates it server-side before trusting it.

This is the approach now being taken for the Emirates Post agent on
`box.emiratespost.ae`, and it is likely the faster path here too: no UAE PASS client
provisioning, no callback registration, no redirect round trip.

If EPGL prefers this route, we need two things:

1. **The `localStorage` key** holding the access token on `app.epgl.ae`. Our loader
   defaults to `accessToken`; any other name is a one-attribute change on the script
   tag (`data-token-key="…"`), no deployment required.
2. **An endpoint that validates the token** and returns the signed-in identity — so
   we verify server-side rather than trusting whatever the page hands us. For
   Emirates Post this is `GET /services/pobox/users/api/v1/Account`, which answers
   `200` for a valid token and `401` for an invalid one. We need the EPGL equivalent.

Our side already permits framing from the EPGL domains, so no change is needed
there. Verified from the live `Content-Security-Policy` response header:

- **Production** (`agent.7x.ae`): `'self' https://www.epgl.ae https://epgl.ae
  https://app.epgl.ae https://idep.epgl.ae`
- **Staging** (`7xagents.7x-lab.com`): the above plus `https://stg.epgl.ae`,
  `https://epro--preprod2.sandbox.my.site.com`, `https://idep-stg.epgl.ae` and
  localhost

If the widget is to be embedded on a domain not in the relevant list, tell us and we
will add it.

---

## Open questions for EPGL, unrelated to sign-in

1. **Where is the licence fee paid?** The EPGL agent has no payment capability
   configured. If the AED 100,000 annual licensing fee and the 10% levy are paid on
   the EPGL portal rather than in the agent, the agent should hand off to that
   payment page rather than attempt to collect it.
2. **`EPG_Emirates_Id__c` in the Form 9 read API.** Version 1.1 of the spec drops
   this field. In the current data it holds 226 of 234 populated records, against 8
   in `LegalEntity_Profile_Person_EmiratesID__c`. Dropping it removes the field that
   nearly all Emirates ID lookups actually resolve against. Please confirm this is
   intended and advise which field should be used instead.

---

## Update — `sandbox_stage` works, and is now configured on staging

At EPGL's suggestion we tried the UAE PASS public sandbox client instead of
`epg_web_stage`. It works, and it unblocks staging testing without waiting for any
provisioning.

| Setting | Value |
|---|---|
| Base | `https://stg-id.uaepass.ae` |
| `client_id` | `sandbox_stage` |
| `client_secret` | `sandbox_stage` |

Note the secret: it is the **same string as the client id**. The value published in
some UAE PASS documentation, `sandbox_stageSecret`, is rejected with
`invalid_client`.

### What we verified

1. **Authorisation accepts arbitrary redirect URIs** — no registration needed. Both
   of our callbacks reach the UAE PASS login page:
   - `https://7xagents.7x-lab.com/api/uaepass/callback` → login page
   - `https://agent.7x.ae/api/uaepass/callback` → login page
2. **The token endpoint accepts the credentials.** Posting a deliberately invalid
   code returns `invalid_grant` ("Invalid authorization code received"), not
   `invalid_client` — so the client pair authenticates and only the code was bad.
3. **The full chain is live on staging.** `/api/uaepass/login?agent=epgl-dialog` now
   redirects through `stg-id.uaepass.ae/idshub/authorize` to the UAE PASS login page
   with `client_id=sandbox_stage`.

### Two limits worth knowing before testing

- **The sandbox issues UAE PASS test personas, not real identities.** Sign-in will
  complete and the agent will treat the customer as authenticated, but the Emirates
  ID returned is a sandbox test value that will not match any real EPGL company
  record. This proves the authentication plumbing end to end; it does not exercise
  the Emirates-ID-to-company lookup. For that we still need either a real staging
  client or test personas whose Emirates IDs exist in the EPGL sandbox data.
- **This is staging only and must stay that way.** `sandbox_stage` on production
  would let anyone sign in as a test persona. Production is unchanged and still
  uses `epg_web_prod` against `https://id.uaepass.ae`, verified after this change.

The two asks in this document therefore still stand for production: the exact
registered `redirect_uri` for `epg_web_prod`, and our callbacks added to it.
`epg_web_stage` provisioning is no longer blocking, but is still the right end state
for staging if EPGL wants staging to mirror production.
