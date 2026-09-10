# Emirates Post bug list — 10 September

**On staging:** https://7xagents.7x-lab.com/embed/nxn-dialog
Numbered to match their list. Take them in any order.

**Read this first.** Bugs **4, 6 and 7 turned out to be one bug**, and it was
ours — not Emirates Post's data. Their backend was refusing us and we were
reporting it as "this branch has no boxes". Details under item 4.

---

## 1 & 8 — The Selection Summary now names the box and the branch

Reported twice, as two bugs. Both are the same omission.

**Test**
1. Rent a new PO Box. Pick an emirate, a branch, a box number and a duration.
2. Let it show you the summary before payment.

**Expect** the summary card to list the **PO Box number** and the **Branch**,
above the money rows, alongside package, emirate, duration and key collection.

**Also worth trying:** ask *"why wasn't the PO Box shown?"* — you should no
longer get an apology and a second, fuller card. The first one should already be
complete.

**Note:** if the card and the case ever disagree, the card's own row wins and
stays visible. That is deliberate — a mismatch is a real problem and hiding it
would be worse than showing it.

---

## 2 — Arabic conversation, Arabic widget

The branch picker, the map button, the readiness bar and the composer all had
Arabic translations already. Nothing was telling them to use them: the language
came from the host page's `<html lang>` and was never revised, so typing Arabic
on the English site gave you an Arabic conversation inside an English widget.

**Test**
1. Open the widget in **English**.
2. Write your first message in **Arabic** — e.g. `أريد استئجار صندوق بريد في دبي`.
3. Carry on to a branch list.

**Expect** the whole interface to switch with you:

| Was | Should now read |
|---|---|
| "18 to choose from" | "١٨ خيارات متاحة" |
| "Browse nearby branches on a map" | "تصفّح الفروع القريبة على الخريطة" |
| "Submission readiness" | "جاهزية الإرسال" |
| "Type your message…" | "اكتب رسالتك…" |

**Then switch back:** write a clean English sentence and it should return to
English.

**Must NOT flip:** an English question containing one Arabic branch name (e.g.
*"Does فرع البرشاء have boxes?"*) should stay English, and a short reply like
`ok`, `hi` or a box number should change nothing either way.

---

## 3 — MyHome Instant is AED 995

It was showing AED 300, which is MyBox's price. Emirates Post return **995** for
`MYHOMEF` — I read it off the production API today.

**Test**
1. Start a new PO Box rental.
2. Look at the three bundle cards.

**Expect**

| Bundle | Per year | Plus |
|---|---|---|
| MyBox | AED 300 | + AED 70 one-time registration |
| MyHome | AED 695 | + AED 70 one-time registration |
| **MyHome Instant** | **AED 995** | + AED 70 one-time registration |

Check in Arabic too — the same three cards, the same three figures.

---

## 4 & 6 — Box numbers not displayed (this was the big one)

**These were not empty branches.** Every branch has boxes. Emirates Post's
backend was refusing our request, and the assistant was reporting the refusal as
"no boxes available".

What I measured on **production** today, against their live API:

```
FreeBoxes, no Authorization header      -> 401
FreeBoxes, X-API-KEY only, no bearer    -> 401
FreeBoxes, Bearer <the customer's token> -> 200
```

And with a bearer, all 29 branches across the three emirates in the report had
free boxes:

| Branch | Free boxes |
|---|---|
| Al Qusais | 8 |
| Al Barsha | 6 |
| NXN – Industrial Sharjah | 25 |
| Umm Quwain Central | 30 |
| Falaj Al Muala | 50 |
| Al Dhaid Post Office | 86 |

The customer's token was used for the one request it arrived on and then thrown
away. The host page sends it when it sends it; on every other turn we called
Emirates Post with no credential at all. It is now kept for the conversation.

**Test**
1. Sign in and start a rental.
2. Pick Dubai → **Al Qusais Branch**. Expect a list of box numbers, not
   "cannot retrieve available boxes".
3. Go back and try **Al Barsha**, then Sharjah → **NXN – Industrial Sharjah**,
   then Umm Al Quwain → **Umm Quwain Central**.
4. Try six or seven branches in one conversation, changing emirate at least once.

**Expect** boxes at every one of them, and — this is the part that was broken —
**at the fifth and sixth as much as the first**. The old failure got worse the
longer a conversation went on, because the token only ever arrived occasionally.

> Staging has less box data than production, so a genuinely empty branch here is
> possible. What must not happen is *"the system cannot retrieve available
> boxes"* — that is the authorisation message, and it should be gone.

---

## 5 — Branch names exactly as Emirates Post write them

It showed "Sharjah Industrial Zone Branch". Their API says
**"NXN - Industrial Sharjah Branch"** — the tester's "Sharjah Industrial Branch"
is closer but still not it. The name was being rewritten, not mistranslated.

**Test**
1. Rental → Sharjah → look at the branch list, then pick the industrial one.

**Expect** the same string on the card, in the button, and in the reply that
follows: **NXN - Industrial Sharjah Branch**. No added "Zone", no dropped
"NXN - ", no reordering.

Spot-check a few others against the list: *NXN - Al Quoz Fourth Branch*,
*Al Rashidyah Complex 3*, *NXN - Branch  Falaj Al Muala* (their spacing, kept).

---

## 7 — Payment could not be completed

Same root cause as 4 and 6. `Rental/Select` needs the same bearer `FreeBoxes`
does, so the reservation was failing with *"a temporary technical issue"* — which
is why it made no difference whether saved-card and auto-renewal were on or off,
and why it failed on identical details minutes apart.

**Test**
1. Rent a box through to the payment step, with **saved card ON and
   auto-renewal ON**.
2. Repeat with **both OFF**.
3. Repeat once in Arabic.

**Expect** the reservation to succeed and a real payment card to appear, in all
three. No *"لا أستطيع حجز الصندوق من النظام في الوقت الحالي بسبب مشكلة تقنية مؤقتة"*.

**If it still fails**, send me the conversation id — the audit log now
distinguishes a refusal from an empty result, so I can tell in one query which
one it was.

---

## And one that was not on the list

The assistant was asking for a map pin to confirm the company's address on EPGL
even when it had already read the address off the trade licence. Not an
Emirates Post journey, but the same guard covers both, so if you see a map
offered for an address already on file, that is worth reporting.

---

## What to send me if something fails

The **conversation id** is enough — everything below is queryable from it:

- whether Emirates Post refused us or genuinely returned nothing
- which branch id we asked for, against the one the customer picked
- what the summary card contained before it reached the screen
- which language the widget thought it was in

Screenshots are useful for anything visual; for the box/branch/payment items the
id tells me more.
