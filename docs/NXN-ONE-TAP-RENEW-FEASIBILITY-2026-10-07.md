# "One Tap to Renew" for personal PO Boxes — feasibility

*7 October 2026. The team's suggestion: compress the personal PO Box renewal to
one or two steps, so a customer jumps straight to renewing. Assessed against the
live staging journey, Emirates Post's PO Box API (spec read 7 Oct), and the
feedback rules Emirates Post has given us. Verdict first, then the reasoning.*

## Built on 8 October 2026 — on staging

The two-tap shape below is implemented and switched on for `nxn-dialog` on
**staging**: `scripts/nxn-one-tap-renew-2026-10-08.ts` (journey config: consent
switches back, guest-only sentences made conditional, the fast path on the
personal renewal), the saved card attached to a signed-in renewal save
(`lib/integrations.ts`), a Renew action on each box in the panel, a start intent
on the embed URL (`?journey=personal_po_box_renewal&box=450293&emirate=DXB`) and
`window.Dialog.start({...})` in the loader, and the sign-in pulse offering the
expiring box's renewal as one button. Tests:
`scripts/test-one-tap-renew-2026-10-08.ts`. Production: not applied — the code
deploys with the next merge to `main`, the config is one script run.

## Verdict

**Two taps in the chat is feasible for a signed-in customer, on our side alone,
in roughly a week.** The payment page itself stays — Emirates Post's backend
opens the payment on their gateway and a saved card only pre-selects there — so
the honest shape is: **tap 1 choose the term, tap 2 confirm and pay, then the
card page.** Literal one tap needs two things only Emirates Post can give:
permission to default the term (their own rule FB-1428 forbids pre-selection) and
a server-side charge on the saved card (they have the engine; it drives
auto-renewal today). **For guests, no: there is no identity to renew against.**

| Shape | Taps in chat | Payment page | Who can do it | Needs from Emirates Post |
|---|---|---|---|---|
| Today (staging) | ~10 interactions | yes | guest or signed-in | — |
| **Two-tap (recommended)** | **2** | yes | signed-in only | nothing; a heads-up that FB-1428 is honoured by showing terms unselected |
| One tap + card page | 1 | yes | signed-in only | relax FB-1428 for signed-in renewals (default = same term as last time) |
| One tap, no card page | 1 | no | signed-in, card on file | a "charge the saved card" call (`Renewal/ProcessPayment`?) |
| Zero taps | 0 | no | signed-in, card on file | already exists: auto-renewal via `UpdateAutoRenewConfig` + their AutoRenewJobEngine |

## What the renewal is today

The live `personal_po_box_renewal` journey is **guest-shaped** — it uses the Guest
endpoints even for a signed-in customer ("Always use the GUEST renewal tools") —
and runs in this order: emirate and box number → the retrieved box shown for
confirmation → bundle upgrade offer → duration cards, each priced by
`Guest/Renewal/Pricing` → subscriber details (who is renewing, first and last
name, mobile, email, billing area and street) → terms and preferences toggles →
`Guest/Renewal/Save`, which returns Emirates Post's payment URL → the customer
pays on their page and comes back → `Guest/Renewal/ConfirmPayment` → completion.
Thirteen fields on one step; two are required (`po_box_number`, `renewal_period`).
About ten customer interactions and five to seven Emirates Post calls.

## What we already know before the customer says anything

For a **signed-in** customer (UAE PASS):

- **Their boxes.** Fetched once on sign-in and written to the case as
  `__account_boxes` — box number, bundle, expiry, status — and listed in the side
  panel with expired ones marked (`Experience.tsx:1119`, commit fdbdae6).
- **Their identity.** The verified Emirates ID from UAE PASS, used already as the
  ownership gate and stamped on rental saves.
- **Everything the subscriber step asks for.** `Renewal/Details` returns
  `poBoxCustomerDetails` (name, mobile, email) and `poBoxAddressDetails` (full
  name, email, mobile, region, street, building, `custProfId`), plus the current
  bundle, expiry, `isRenewable` with reasons, `possibleExpiryDates`,
  `isAutoRenewEnabled` and the authorised agents. The guest variant masks the
  holder's name; the authenticated one does not.
- **Their card.** `nxn_saved_cards` reads what Emirates Post holds; sending it on
  a save pre-selects it on their payment page (`scripts/nxn-saved-card-2026-09-02.ts`).
  Today it is sent **only on rental saves** — the renewal save forces
  `saveCreditCard` and `isAutomaticSubscriptionEnabled` to false
  (`integrations.ts:2779`) and the save-card and auto-renew switches were removed
  from both renewal journeys when they became guest-shaped. Wiring the card onto
  the renewal save is part of the work below.
- **Who is renewing.** Already answered without asking: when the box is on the
  signed-in customer's own list, `GetRenewedByOptions` is resolved to the owner
  key and the model is told not to ask (`integrations.ts:3497`). A box they hold
  as an authorised agent (`isOwner: false`) cannot be renewed on their account and
  is excluded from the fast path.
- **A foothold in the prompt.** The global rule for "renew as is" already says:
  take the bundle and branch from the record, use the standard period, price it,
  and go straight to summary and payment (`prompt.ts:241`). The fast path is that
  rule made the default for a signed-in customer, with the term still chosen.
- **Their session.** `backendSessionToken` — rentals already call the
  session-bound endpoints with it; the authenticated `Renewal/*` family is the
  same.

So of the thirteen fields, the customer genuinely has to decide **one**: the
term. Everything else can be recorded from Details with `collect_field`, which
the existing "CONTACT FROM PROFILE" rule already permits for signed-in customers.

## The constraints that shape the design

1. **FB-1428 (Emirates Post, 28 July 2026): nothing is pre-selected.** Emirate,
   branch, box, bundle and duration are presented unselected; a badge like "Your
   usual branch" is allowed, pre-picking is not. A literal one-tap "Renew for 1
   year, AED 250" pre-picks the term. Duration cards with prices, none selected,
   comply — that is tap 1.
2. **Terms before payment are mandatory**, enforced in code for our checkout
   (`tools.ts:943`) and for Emirates Post's gateway (`chat/route.ts:1061`), and
   the guidance already says not to ask for them as a separate step. They sit in
   the same toggles block as "Proceed to payment" — that is tap 2.
3. **The payment page cannot be skipped by us.** `Save` creates the order and
   opens the payment on Emirates Post's N-Genius outlet; a saved card is only
   pre-selected there and the customer can still change it. Card entry or 3-D
   Secure happens on their page. Only Emirates Post can charge a token
   server-side — their `AutoRenewJobEngine` does exactly that for auto-renewal.
4. **Prices come from Emirates Post, per term, for the exact expiry date**
   (day and month preserved, grace rule for expired boxes). One Pricing call per
   card shown; the cards already do this. A box that is "Pending approval" or
   "Rejected" is not renewable (`isRenewable` is false) and must not be offered.
5. **Renewal stays open to guests** (FB-1168: offer sign-in, never require it).
   The fast path is therefore a signed-in-only branch beside the guest journey,
   not a replacement.
6. **There is no way to open the chat already inside a journey.** The widget
   accepts `locale`, `handoff`, `expand`, `collapse` and `close` from the host and
   reads no journey or box from the URL. "Jump directly" from the app's box list
   needs a small entry point (below).

## The two-tap flow, concretely

**Entry.** Either a "Renew" action on a box in the side panel, a line in the
sign-in pulse for an expiring box, or the app opening the chat with
`?journey=personal_po_box_renewal&box=450293&emirate=DXB` (new; see work). On
entry the agent calls `Renewal/Details` and `Renewal/Pricing` for each permitted
term, then renders **one message**:

- the box, bundle, current expiry and subscriber shown as facts, not questions;
- duration cards, none selected, each with Emirates Post's price and the new
  expiry date (with the grace sentence for an expired box);
- a "Your card ending 1111 will be offered" line when one is on file.

**Tap 1 — the term.** The agent records `renewal_period`, fills the subscriber
fields from Details, and renders the summary (price rows, total) with the
preferences block: terms checkbox, save-card and auto-renew switches defaulting
on for a signed-in customer, confirm button "Pay AED 250".

**Tap 2 — confirm.** `Save` with the saved card → Emirates Post's payment page
opens in the same popup rentals use → the customer pays → the return message
triggers `ConfirmPayment` → one completion line with the new expiry, the receipt
link and, if consented, `UpdateAutoRenewConfig`.

Two taps, one card page, two Emirates Post reads, one save, one confirm.

## Work to get there

| | Where | Size |
|---|---|---|
| A signed-in fast-path in the renewal guidance: subscriber fields recorded from Details, summary and preferences in one block, guest path untouched | journey config script (DB), like the other dated scripts | 2 days incl. tests |
| Re-enable the authenticated `Renewal/Details`, `Renewal/Pricing` and `Renewal/Save` for sessions only — they were disabled deliberately (`trim-nxn-tools.ts`, `docs/NXN-API-ENDPOINTS.md:296`) because the model picked them first for guests; the choice must be made server-side from the session, not by the model | `integrations.ts`, tool trimming | 1 day |
| Send the saved card on the renewal save as the rental save does, and stop forcing `saveCreditCard` / `isAutomaticSubscriptionEnabled` off for a signed-in renewal | `integrations.ts:2037-2240, 2779` | half a day |
| Map the emirate NAME stored in `__account_boxes` to the three-letter code the renewal calls need (`nxn_boxes_for_customer` returns it verbatim) | chat route | small |
| Journey entry from outside the chat: `?journey=&box=&emirate=` on the embed URL and a `{action:"start", journey, data}` host message; a "Renew" action on panel boxes | `Experience.tsx`, `packages/embed`, chat route | 1–2 days |
| Pulse line for expiring boxes offering the renewal as one button | guidance; the pulse already names them | half a day |
| Mobile app: open the chat with the deep link from the box list | Emirates Post app team, per the WebView contract | theirs |
| Tests: fixture journey, fast path only when signed in, no pre-selection, terms still gate | scripts | included |

Roughly a week of our time, nothing new from Emirates Post. Two code facts to
respect on the way: `ConfirmPayment` has a 75-second "too early" guard after the
save, and a renewal is only reported done when that call returns success.

## What to ask Emirates Post, in order of value

1. **Relax FB-1428 for signed-in renewals** so the previous term can be offered
   as the default ("Same as last time — 1 year, AED 250") with the alternatives
   one tap away. That turns two taps into one. Their call; it was their rule.
2. **Is there a server-side charge on a saved card?** `Renewal/ProcessPayment`
   sits beside `ConfirmPayment` with the same body and no description. If it
   charges the stored token the way their auto-renew engine does, the card page
   disappears and "one tap" is literal.
3. **Confirm the authenticated `Renewal/Details` returns the unmasked subscriber**
   (the guest one masks the name), so the subscriber step can be prefilled
   rather than confirmed.
4. **Confirm the auto-renew engine actually runs.** Their API names an
   `AutoRenewJobEngine` request source and their portal describes auto-renewal as
   charging the saved card on a schedule, but we have never observed a renewal it
   performed. The zero-tap option below rests on it.

## The zero-tap option already exists

Auto-renewal: the chat can switch it on today (`nxn_set_auto_renew` →
`UpdateAutoRenewConfig`), and on Emirates Post's description their engine renews
the box and charges the saved card without anyone tapping anything — subject to
ask 4 above, since we have not yet seen it run. For a customer who keeps a box for
years that is the better answer than a fast manual flow, and the two-tap
completion line should offer it once ("Renew automatically next year?") — which
the preferences block already does when they are signed in.

## Regulatory frame, in one paragraph

The readiness checklist the agents are scored against says consent is
per-action, never standing; every approval names the action, the data and the
cost; and fees are shown clearly before explicit approval. The two-tap flow meets
it as drawn — the price is on the card the customer taps and on the button they
confirm — and so does one tap with a defaulted term, as long as the button names
the amount. A silent charge with no named amount would not, which is one more
reason the zero-tap answer is auto-renewal the customer switched on, not a
payment the chat took by itself.

## What this does not cover

Corporate renewals need a trade licence number and sometimes Tijari details —
one more tap at least, and a different assessment. Guests stay on the current
journey; it can be tightened (emirate and box in one line, details confirmation
merged into the duration cards) to about six interactions, but not to two.
