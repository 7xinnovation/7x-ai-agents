# "One Tap to Renew" for personal PO Boxes — feasibility

*7 October 2026. The team's suggestion: compress the personal PO Box renewal to
one or two steps, so a customer jumps straight to renewing. Assessed against the
live staging journey, Emirates Post's PO Box API (spec read 7 Oct), and the
feedback rules Emirates Post has given us. Verdict first, then the reasoning.*

## Built on 8 October 2026 — on staging

Built as ONE tap, by the team's decision on 8 October: the Renew entry states
"one more year, same bundle and options" in the customer's own message, so the
term is collected rather than pre-selected, and the reply is the summary, the
Before-payment switches and "Pay AED x" at once; a longer term or a different
bundle is one sentence away. (The two-tap shape below was the assessment's
recommendation under FB-1428; the one-tap entry keeps the rule's letter because
the customer's message names the term, and the ordinary flow with unselected
cards remains for anyone who asks for something else.) Switched on for
`nxn-dialog` on **staging**: `scripts/nxn-one-tap-renew-2026-10-08.ts` (journey config: consent
switches back, guest-only sentences made conditional, the fast path on the
personal renewal), the saved card attached to a signed-in renewal save
(`lib/integrations.ts`), a Renew action on each box in the panel, a start intent
on the embed URL (`?journey=personal_po_box_renewal&box=450293&emirate=DXB`) and
`window.Dialog.start({...})` in the loader, and the sign-in pulse offering the
expiring box's renewal as one button. Tests:
`scripts/test-one-tap-renew-2026-10-08.ts`. Production: not applied — the code
deploys with the next merge to `main`, the config is one script run.

## Two ways to pay on the one tap — 11 October 2026

The Before-payment block now ends in two buttons: **"Pay AED x with Card"**
and **"Pay AED x with Noqodi (UAE Pay)"**. The tap is the choice; nothing is
asked separately.

- **Card** is today's path: Emirates Post's `Save` opens the payment on their
  gateway, the customer pays there, their confirm call verifies it.
- **Noqodi (UAE Pay)** is taken on our checkout first (signed-in customers
  only, because UAE Pay requires the Emirates ID the sign-in carries). Once it
  settles, the same `Save` is called to **record** the renewal, the payment URL
  Emirates Post returns is ignored, and their confirm call is not made.

**The caveat, stated plainly:** Emirates Post's own system still opens a
payment for that order on their gateway and sees it unpaid, because their
gateway did not take the money. The renewal is recorded on their side and paid
on ours. That is the same position production rentals have been in since
August (paid on our checkout, then saved), and it is why the ask in
`docs/NXN-UAEPAY-ASK-2026-10-07.md` still stands: either their `Save` returns a
UAE Pay link, or they accept an external payment reference. Until one of those
lands, a Noqodi renewal needs their back office to reconcile our settlement.

Guests see the card button alone and one sentence that Noqodi needs a sign-in,
and `request_payment` refuses Noqodi without a verified Emirates ID before the
gateway is reached. A gateway that does not answer is now a tool error with a
plain message rather than a failed turn. The opener sentence is recognised by
the chat route itself, which directs that turn per sign-in state (the prompt
alone produced a "just to confirm" echo one run in two on staging).

Verified locally with the mock persona on 11 October: opener → summary and the
two buttons; "Pay AED 695.00 with Noqodi (UAE Pay)" → a UAE Pay payment for the
quoted AED 695 on `uat-pay.uaepay.ae`; settled → the save was called, their
confirm was not, no pay block. The save did not go through in that
run; the customer was told plainly: payment confirmed, renewal not yet recorded,
reference and enquiry link given. *(Corrected later the same day: the save tool
was not refused by Emirates Post — it was switched OFF in the local database's
copy of the integration, so the model's call came back "unknown tool". Staging
and production have it on. The local copy now mirrors staging's operation
flags.)* Code: method-aware `backendGateway` and save gate in
`chat/route.ts`, the "RECORDED, paid on our side" wording for a Noqodi-paid
save and `getLastPriced` in `lib/integrations.ts` (so `request_payment` charges
the term's quoted price), the Noqodi branch in `prompt.ts` backend-gateway
mode, `confirm: A | B` in the toggles block, the `payment_method` field on the
personal renewal, and a test Emirates ID for the local mock persona.

## Straight to payment — 11 October 2026, evening

The user's reading of the flow above: "still showing unnecessary steps — it
should jump straight to payment." The step they meant was the one between the
Renew tap and the payment page: a Before-payment block with switches and two
buttons, whose tap started a second model turn that saved the order and only
then produced a pay card to tap again. Three taps and two waits to reach a
payment page.

**Now, for a signed-in customer, the Renew tap is the last thing asked before
the payment page.** The one reply prices the renewal, records the fields, SAVES
the order with Emirates Post, and shows:

- the renewal summary (bundle, term, current and new expiry, fee, and a row
  `Auto-renewal: on/off, as now`);
- the pay card — **"Pay AED x with Card"** — whose button *is* Emirates Post's
  payment page for that order;
- one button beneath it, **"Pay AED x with Noqodi (UAE Pay) instead"**;
- the sentence "By paying you accept the Terms and Conditions" (linked), and
  one sentence that a longer term or a different bundle is available on request.

No switches, no checkbox. Consents are "same as now": the card is not saved
unasked and auto-renewal is left exactly as the box has it (`isAutoRenewEnabled`
from the details); after a successful payment the one next-step button offers
to switch auto-renewal on if it is off. The terms are accepted by paying, as the
sentence under the button says, and recorded as such when the customer comes
back from the payment page (or taps the Noqodi button). This replaces the
ticked checkbox NXN's round-two feedback asked for on the ordinary flow — the
ordinary flow (a different term or bundle) still shows it; the one-tap path
states acceptance beside the button instead. Flagged to the team as a product
decision to confirm with Emirates Post.

**Noqodi instead** starts our UAE Pay checkout for the quoted total. The order
already exists at Emirates Post from the save, so when the payment settles
nothing is saved again and their confirm tool is not called; the customer gets
the order reference, the new expiry and the receipt. The same caveat as above
applies: Emirates Post's gateway sees that order unpaid until they take a UAE
Pay link or an external reference.

**Guests are unchanged**: identity line, summary, terms checkbox, card button,
and a sentence that Noqodi needs a sign-in — a guest cannot be saved before
their details are known.

**How it is enforced** (`apps/web/app/api/chat/route.ts`): the server
recognises three sentences for Emirates Post and directs each turn itself —
the opener (the Renew pill's sentence *and* the pulse button's shorter "Renew PO
Box n for another year", English or Arabic), the "with Noqodi (UAE Pay)
instead" tap, and the pay card's return sentence — so the model never has to
find the rule in a long guidance. The opener turn is allowed ten tool rounds
instead of six (`maxToolRounds` on `runTurn`), because details, pricing, the
field recordings and the save do not fit in six when the model prices twice.
The backend-gateway flag is decided from the agent's flows when no journey is
set yet (the first turn of a conversation), so the save on that turn is
annotated correctly. The payment-settled directive knows an order that already
exists and says so. `scripts/nxn-one-tap-renew-2026-10-08.ts` carries the same
rules into the journey guidance (re-run on each environment); Arabic
conversations get Arabic labels. The save-before-pay gate's refusal is now
audited (`save_blocked_unpaid`), and `DIALOG_DEBUG_TOOLS=1` logs every
integration tool result on the server, which is how the "unknown tool" above was
found.

**Seen locally** (mock persona, 11 October evening), in English and Arabic:
Renew → one reply with summary, pay card (Emirates Post payment URL), Noqodi
button, terms sentence; back from the payment page → one confirm call → "renewed
through 03-02-2027", receipt, auto-renew offer; Noqodi instead → UAE Pay
payment for the quoted amount → settled → no save, no confirm, reference given.
The mock persona's save and confirm are simulated (`lib/mockPersona.ts`) so
this can be seen on a laptop: the card opens N-Genius's UAT page with a code it
will not know, and the confirm answers paid. UAE Pay's UAT gateway was
unreachable for stretches of the evening; the turn reports "could not be
opened, nothing charged" and offers card or retry.

## Hardening pass — 12 October 2026

The user asked for everything to be checked once more, both ways to pay and the
one tap, before the push. The static suites were already green (typecheck, 77
one-tap checks, 42 end-to-end). Driving the live flows against the local server
with the mock persona, in English and Arabic, turned up five rough edges, all
now fixed and covered by checks (one-tap suite 84):

- **A stray auto-renewal call.** On an Arabic settled turn the model called
  `nxn_set_auto_renew` unasked, before offering the button. It was refused
  (the mock has no Emirates Post session), but a real session would have had a
  box's auto-renewal flipped without consent. The return directive, the
  Noqodi-settled directive and the fast-path guidance now say the tool is called
  only when the customer taps the button or asks.
- **Two sentences for one tap.** "Pay with Noqodi instead" produced "Your secure
  payment is ready below" twice over, because the per-turn directive and the
  request_payment result each asked for that line. The directive now says it is
  the same single sentence.
- **"Your receipt is ready above"** when the download link is appended under the
  reply. Directive, confirm annotation and guidance now say where it lands.
- **A save that arrived without customerKYC.** One run sent the save with no
  subscriber at all; our local gate refused it, the refusal mentioned the
  renewed-by options, the model fetched them and saved again — one order, but
  ten seconds and two rounds later. The gate now fills customerKYC from the
  subscriber fields the conversation holds (and, for a real sign-in, the
  contact_name/phone/email a UAE PASS login seeds; for the mock persona, its
  profile) before refusing, names exactly what is still missing, and no longer
  points at the renewed-by options when renewedBy is already on the request.
  The directive and the guidance name the save body explicitly. In the three
  runs after the change the model sent the subscriber itself; the fill is the
  net under it.
- **The mock persona's "Enable auto-renewal" tap** went to "cannot be set
  without a signed-in session". It is now simulated for the mock persona only,
  audited as `mock_auto_renew`, so the tap can be exercised locally.

Verified after the fixes, each as one conversation on the local server:

| Run | Result |
| --- | --- |
| Noqodi: Renew → Noqodi instead → webhook → settled → Enable auto-renewal | 11 checks, 0 failed |
| Card: pulse sentence → back from the payment page → Enable auto-renewal | 9 checks, 0 failed |
| Arabic card: opener → Arabic return sentence | 8 checks, 0 failed |
| Arabic Noqodi tap | one sentence, payment for the quoted total, no second save |
| Guest opener | unchanged: identity line, summary, Terms checkbox, card button, sign-in sentence |

The config script was re-applied to local and staging (one change each). The
Noqodi rollout dry-run on staging reports EPGL and NXN already on. The staging
env file had to be recreated from the app's settings (subscription of
rg-7xil-external-stg).

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
