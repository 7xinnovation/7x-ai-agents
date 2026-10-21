# Changing the duration after the box is reserved

*21 October 2026. Found while testing the duration fixes on staging.*

## What happens now

Emirates Post reported that changing a 1-year subscription to 2 years left the
total at AED 400 — the 1-year figure — while the line items read 600 + 70 + 30.
That is fixed: the reservation's term is compared against the duration the
customer has chosen, no total is stated while they disagree, and `Rental/Save`
refuses outright rather than charging the held term.

Verified end to end on staging with a real reservation (box 58198, Bani Yas,
held for 1 year at AED 370 with the payment page open):

> **Customer:** Mira, can I change the subscription period to two years?
>
> **Mira:** The payment page is already open for your current order. If you
> close it without paying, I can set up a fresh order for 2 years instead.

No duration menu was re-shown, and no total was quoted against the old hold.
That is the behaviour we want.

## The wrinkle, which is theirs rather than ours

Confirming the switch produced this:

> Box 58198 cannot be reserved for 2 years right now. This may be because the
> previous hold is still active.

It is. `Rental/Select` holds the box for the term it was called with, and
**their API has no way to release a hold early** — the registered operations are
Bundle, ExpiryDates, BoxLocations, FreeBoxes, GetRejectedBoxDetails,
renewaldetails, Save, Select, UpdatePayment and UpdateRejectedBoxDetails. There
is no cancel.

So a customer who changes their mind about the duration **loses the box number
they picked** and has to choose another, or wait for the hold to lapse (ours ran
to 23:00 the same day). The assistant handles it gracefully — it offers the
other available boxes — but it is a worse outcome than it needs to be, and at a
branch with only one or two free boxes it can mean no box at all.

## What to ask Emirates Post for

A way to release or amend a reservation. Either would do:

1. **Release** — `Rental/Cancel` or similar, taking the reservation reference,
   so a superseded hold can be given back before re-reserving the same box.
2. **Amend** — let `Rental/Select` take an existing reservation reference and
   change its term in place.

Until then the behaviour above is the correct one: a box the customer has to
re-pick is recoverable, a subscription they paid one year for believing it was
two is not.
