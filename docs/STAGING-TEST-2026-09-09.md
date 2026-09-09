# Staging test plan — 9 September

Everything below is on **staging only**. Production is nine commits behind and
unaffected.

- Emirates Post: `https://7xagents.7x-lab.com/embed/nxn-dialog` (or the widget on `www-stg.emiratespost.ae`)
- EPGL: `https://7xagents.7x-lab.com/embed/epgl-dialog` (or `stg.epgl.ae`)

**Before you start:** hard-reload the host page (⌘⇧R / Ctrl-F5). The loader is
cached, and several of these tests are meaningless against an old copy.

Confirm you have the right one — in the console on the host page:

```js
window.Dialog.diagnose().version    // must be "2026-09-09a"
```

---

## 1. Widget size

The one I have got wrong repeatedly, so this is the first thing to check.

1. Open the widget on `www-stg.emiratespost.ae`.
2. Look at the top of the panel: **the header row must be visible** — logo, "Online", عربي, refresh, expand.
3. Resize the browser window shorter and taller a few times. The panel should shrink to fit and never lose its header.

Then, in the console:

```js
window.Dialog.diagnose()
```

**Pass:** `clippedAtTop: false`, `rect.top` is at least 24, and `rect.bottom` is
within the window height.

**If it still clips,** send me the whole object. `fixedPositioningBrokenBy` is the
field that matters — if it names an element, the cause is on their page and no
change of ours can reach it.

> What changed: the panel used to compute its available room from a variable read
> off the page root while being *positioned* by the same variable resolved on the
> frame. When a host sets it elsewhere the two disagreed. It now measures where it
> actually landed and takes the difference off its own height — it only ever
> shrinks, never moves.

---

## 2. The enquiry link

1. Ask something outside Phase 1 — e.g. *"how do I complain about a late delivery?"*
2. The reply should offer to raise an enquiry.
3. **Click the link.**

**Pass:** it opens `www.emiratespost.ae/contact-us/raise-an-enquiry` and the page
loads.

**Fail:** anything showing `www-stg.emiratespost.ae` or a browser username/password box.

4. Repeat in Arabic. **Pass:** the link goes to `.../ar/contact-us/raise-an-enquiry`.

> This was broken in **both** environments — the link had never worked for anyone.

---

## 3. Arabic interface

Switch to عربي and run a personal rental as far as the branch list.

| Where | Was | Should now be |
|---|---|---|
| The branch dropdown | `to choose from 18` | Arabic |
| The map button | `Browse nearby branches on a map` | Arabic |
| A P.O. Box hall notice | a paragraph of English | Arabic |

For the hall notice, pick **Al Rashidyah Complex 3** or any branch badged as a
P.O. Box hall — the notice appears before you can continue.

**Pass:** no English text in any control or notice during an Arabic conversation.

> The controls read their language from the upload context, which is deliberately
> withheld while a message is still animating — so anything rendered mid-stream
> fell back to English.

---

## 4. All three bundles

1. In **Arabic**, start a new personal PO Box.

**Pass:** the plan cards show **MyBox, MyHome and MyHome Instant** — all three.

2. Repeat in English. Still three.

> The API always returned three; the Arabic reply was shortening the list.

---

## 5. The branch reaches the summary

1. Start a personal rental, pick an emirate, pick a branch, pick a box number.
2. Look at the **application panel on the right** as soon as the box numbers appear.

**Pass:** the branch is filled in with its name — not blank, not "not yet chosen" —
and it stays right through to the order summary.

> Asking Emirates Post for a branch's free boxes *is* the customer choosing it, so
> the branch is recorded then rather than waiting for the assistant to remember.

---

## 6. Questions that used to go unanswered

Ask each of these — in Arabic and English — and check you get a real answer
rather than "the knowledge base does not contain enough detail".

| Question | Expected |
|---|---|
| What payment methods can I use online? | Card on the secure page; saving the card and auto-renewal are optional and off by default |
| What documents do I need to rent a PO Box? | UAE PASS sign-in; nothing else for a personal box |
| Can my sister rent a box and register it in my name? | No — it is rented in the name of whoever signs in. She can be added as an **authorised agent** |

**These two should still route you to an enquiry** — that is correct, not a bug:

| Question | Expected |
|---|---|
| What payment methods can I use at the branch? | Says it cannot confirm, offers the enquiry link |
| Can I move my box from one branch to another? | Says it cannot confirm, offers the enquiry link |

> Both are Emirates Post's policy and not ours to state. Worth asking EPG for the
> real answers — they will keep being asked.

---

## 7. EPGL — the parts that work

1. Start a new licence application.
2. Upload the trade licence and MOA.

**Pass:** you are **not** asked for the owner's Emirates ID as a separate
document. Partner 1's Emirates ID covers it.

3. Carry on to the company details.

**Pass:** you are **not** asked to pin the company address on a map when the
address has already been read off the trade licence. Check the panel — if
"Street address" is filled, no pin should be requested.

4. Reach the payment step.

**Pass:** you are asked how you want to pay, with two choices — **Card payment
(online)** and **Bank transfer (Virtual IBAN)**.

---

## 8. EPGL — the part that will still fail

**This is expected to fail, and it is not ours.**

Choose either payment method and let it submit. It will be rejected with a
Contact validation error, and the assistant will tell you it cannot complete the
submission.

**What good looks like here:** it should say so plainly and offer the enquiry
route. It should **not** claim a payment failed, invent a reference, or loop
retrying.

The cause is confirmed against their org: the validation reads
`Is_Primary_Contact__c`, and that field is `createable: false` for our
integration user — we cannot write it, so no API-created Contact can satisfy the
rule. It is with EPGL; see `EPGL-SUBMISSION-CURRENT-2026-09-09.md`.

Until they grant that access, the Virtual IBAN branch also cannot be verified
end to end, because nothing can complete a submission to test it.

---

## What is NOT fixed yet

- **Emirates Post payment failing on production** — Emirates Post is returning an
  *authorisation* failure on `Rental/Select`, not an availability problem. Two
  identical payloads two minutes apart, one accepted and one rejected. Needs
  their side. My `Source: "ChatBot"` change is not the cause — the successful
  calls carry it too.
- **Knowledge retrieval is keyword-only.** No embeddings exist on either
  environment and Arabic runs without a stemmer, so an Arabic question can miss a
  correct Arabic passage. Turning that on is a separate piece of work.
