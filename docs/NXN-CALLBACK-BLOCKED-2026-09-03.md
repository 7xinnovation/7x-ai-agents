# `/nextApi/case` — callback request blocked by CAPTCHA

**Asking for:** a server-to-server way to raise a case, or an exemption for our
service. Everything below was tested against staging on 2 September 2026.

## What we are trying to do

When a customer in the assistant asks for a callback, we want to raise it in the
same queue your contact form feeds, so your team sees it where they already work
and the customer gets a case number they can quote. Today we cannot, so those
callbacks go to an ops mailbox instead — outside your system entirely.

## The request

```http
POST https://www-stg.emiratespost.ae/nextApi/case
Content-Type: application/json
x-turnstile-token: <a Cloudflare Turnstile token>
```

```json
{
  "origin": "Web-EP",
  "caseType": "Inquiry",
  "firstName": "Ahmed",
  "lastName": "Al Mansoori",
  "mobilePhone": "00971553708434",
  "email": "ahmed@example.com",
  "message": "Requesting a callback about PO Box renewal.",
  "emirateCode": "DXB",
  "poBoxNumber": "50500",
  "trackingNumber": "",
  "attachments": []
}
```

The shape is taken from your own contact form's production bundle, including
`origin: "Web-EP"` and the mobile as `00` + digits, no `+` and no spaces — your
form validates against `^971\d{9,}$` before it will submit.

## The response

```
HTTP 403
{"message":"Invalid CAPTCHA token"}
```

Every request without a valid `x-turnstile-token` returns this. We also tried it
with the token in the body rather than the header, and under other header
spellings — same 403 each time.

## Why we cannot solve this ourselves

Cloudflare Turnstile issues its token to a **browser** that has completed a
challenge. Our assistant raises the case from a **server**, on behalf of a
customer who is talking to us in chat, so there is no browser in the loop to
issue one. It is not a matter of us obtaining a key: the mechanism assumes a
front-end, and there isn't one at that moment.

## What would unblock it — any one of these

1. **An API key or service credential** that bypasses Turnstile for our
   registered service.
2. **An allow-list** for our egress IPs on that endpoint.
3. **A separate server-to-server endpoint** that creates the same case type,
   without the CAPTCHA. This is our preference — it keeps the public form's
   protection exactly as it is.

We do not need the public endpoint changed or its protection relaxed.

## Until then

The assistant still takes the callback and still tells the customer it is
raised — it is emailed to the ops mailbox rather than lost. But it does not
reach your case queue, and the customer gets no case number.

## Where this lives our side

`apps/web/lib/epCase.ts`. It is already written against the contract above and
returns `not_configured` rather than calling, because a call without a token can
only ever 403. Give us any of the three routes and it is a config change.
