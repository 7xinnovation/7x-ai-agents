# Offering "Pay with Noqodi (UAE Pay)" on PO Box rentals and renewals — what we need from Emirates Post

*7 October 2026. One page for Emirates Post's PO Box API team. The chat agent
already takes Noqodi (UAE Pay) payments for another tenant; for Emirates Post it
cannot, because the payment is opened and confirmed by your backend. Two ways to
close that, and a preference.*

## What happens today

Every chargeable flow on `box-stg.emiratespost.ae/services/pobox` opens the
payment on **your** gateway and confirms it against **your** gateway:

```
POST /api/v1/Rental/Save                 → paymentGateWayResponse.paymentUrl (N-Genius), referenceNumber
POST /api/v1/Rental/UpdatePayment/{referenceNumber}   → isPaymentSuccess

POST /api/v1/Guest/Renewal/Save          → paymentGateWayResponse.paymentUrl, referenceNumber
POST /api/v1/Guest/Renewal/ConfirmPayment { paymentReferenceNumber }   → isPaymentSuccess
(same shape: Renewal/Save → Renewal/ConfirmPayment · ChangeAddress/Save → ChangeAddress/Confirm/{paymentRefNo} · ChangeLock)
```

`paymentProperties` carries `paymentReturnUrl`, `saveCreditCard`,
`isAutomaticSubscriptionEnabled`, `billingDetail` and `savedCard` — nothing that
names a gateway — and no endpoint accepts a payment reference that your gateway
did not issue (we tried: the confirm step reports such an order as unpaid, which
is correct). So to offer Noqodi we need one of the following.

## Option A — your backend offers UAE Pay as a gateway (preferred)

Emirates Post Group is a federal entity and UAE Pay is the federal platform, so
the merchant relationship sits where the money already settles. The API change is
small and keeps every existing step:

- `paymentProperties.paymentGateway`: `"NGENIUS"` (default, today's behaviour) or
  `"UAEPAY"`, on `Rental/Save`, `Guest/Renewal/Save`, `Renewal/Save` and the
  change-address / change-lock saves.
- For `"UAEPAY"`, `paymentGateWayResponse.paymentUrl` is the UAE Pay hosted page
  and `referenceNumber` is UAE Pay's `merchantRequestId`; `UpdatePayment` /
  `ConfirmPayment` check UAE Pay's inquiry API instead of N-Genius.

**On our side nothing else is needed.** The chat already opens `*.uaepay.ae`
payment pages in the same popup it uses for yours, and the return and confirm
steps are unchanged.

## Option B — we take the payment, you record it

We hold a UAE Pay merchant (UAT today). We would take the payment and tell you:

```
POST /api/v1/Rental/RecordExternalPayment          (and a renewal equivalent)
{ orderNumber | referenceNumber, provider: "UAEPAY",
  paymentRefNo: <noqodiReferenceId>, amountPaid, paidAt, payerEmiratesId }
→ PaymentResponse { isPaymentSuccess, paymentDetails, transactionDetails }
```

This works technically but moves the money: it settles to our UAE Pay merchant,
not to your acquirer, which needs a commercial arrangement and a reconciliation
between the two. We would rather not propose that unless Option A is not possible.

## Questions

1. Is Emirates Post Group already onboarded with UAE Pay / noqodi? If so, Option A
   is a configuration on your side plus the `paymentGateway` field.
2. Which option, and roughly when? We are ready to test on `box-stg` the day it is.
3. `Renewal/ProcessPayment` sits beside `Renewal/ConfirmPayment` with the same
   body. Does it do anything different that we should be using?

## What is ready on our side

The Noqodi switch exists per agent (currently **off** for Emirates Post), the
gateway binding is configured on staging, the agent refuses a Noqodi payment while
the switch is off, and the pay button already accepts UAE Pay hosts. The moment
your `Save` can return a UAE Pay link, it is a switch rather than a release.
