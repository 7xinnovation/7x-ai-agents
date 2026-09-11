# EPGL — the eight enhancements, 11 September

**On staging:** https://7xagents.7x-lab.com/embed/epgl-dialog
Numbered to match your list. Two of them need an answer from you rather than a
retest — items 3 and 6 are marked where that applies.

**Read this first.** Three of these (1, 7, 8) were answered from two different
places: the guidance the assistant follows while it is *taking* an application,
and the knowledge base it answers *questions* from. A question starts no
application, so the second one is what you hit if you simply ask. Both are
updated. If you find one of them right in the middle of an application and wrong
when you ask about it cold, that is the seam — tell us and we will look there.

---

## 1 — One business day

Was "typically within 2 business days", in four places: both journeys, and the
FAQ in both languages.

**Test** — ask, in a fresh conversation: *"How long does it take?"* and again in
Arabic. Then submit an application and read the "what happens next" bullets.

**Expect** one business day everywhere. No "2 business days", no «يومي عمل».

---

## 2 — An old MOA

It **was** detected. It was then explained away, and the reason is worth knowing
because it was a deliberate decision that turns out to have been half right.

A company's registered name and its trade name are different strings on
different documents — the MOA carries one, the trade licence leads with the
other. In August an applicant's perfectly correct MOA was refused as "another
company's document" on exactly that difference. So a name mismatch was changed
to **ask** rather than refuse.

But a new-licence application only ever captured **one** company name. With one
name on file, "this might be the company's other name" is available forever, and
an old MOA naming a superseded name gets the same benefit of the doubt as a
legitimate trade name.

It now captures **both** — the registered name and the trade name, in English
and Arabic, off the trade licence. And once two names are on file, the
registered-versus-trade explanation is used up: a document naming a third,
unrelated name is refused, saying which two names the application is for and
asking for the current version.

**Test**
1. Upload a trade licence. Check the panel shows **both** the company name and
   the trade name, and their Arabic forms where the licence prints them.
2. Upload an MOA for a **different** company.
3. **Expect** it refused, with both of your names quoted back and *"if the
   company has been renamed, the document is an old one — please upload the
   current version."*
4. Then upload the **correct** MOA, whose legal name differs from the trade
   name, and expect it accepted with no argument.

> If step 4 is refused, that is the August bug coming back and we want to know
> immediately.

---

## 3 — "Which postal services will the company provide?" — needs your decision

Two things here, and one of them is a question back to you.

**What we changed.** The question is no longer asked when the trade licence
already answers it. A courier company's licence prints the activities, usually
as names rather than numbers ("Transport of Documents", "Transport of Letters",
"Transport of Parcels"); those are now read off the document, recorded, and
shown in the pre-submission summary where they can be corrected. Asking for
something the document in front of us already states is the one thing this
journey is not supposed to do.

**What we did not change, and why.** On 8 September EPGL told us the opposite:
*"activity_codes is the customer's answer, not something to read off the trade
licence — a restaurant applying for a postal licence still has to say which
postal service it will carry out."* Those two rules were both sitting in the
prompt, contradicting each other. We have resolved it in favour of the document
where the document has an answer, and kept the ask for the case the 8 September
rule was written for.

**The company in your screenshot is that case.** It is a bubble-tea company —
its DED activities are food and beverage, so its licence names no postal
activity, and it will still be asked. Retesting with that same company will show
the question again, correctly.

**Your decision.** You asked whether the information is required. Measured
against your own PreProd org today: `EPG_License_Request__c.Activity_Codes__c`
is **nillable** — not required by Salesforce — a free-text string rather than a
picklist, and every example in your swagger sends the same single value,
`5320002`.

So it is optional as far as the API is concerned. Whether it is required as
*licensing policy* is yours to say. If you want the question dropped entirely,
say so and it is a one-line change.

---

## 4 — The timeline sits with the payment choice

Not after it. The applicant is choosing between two things partly on how fast
each one is, so both lines are now in the same message as the two buttons.

**Test** — reach the payment step.

**Expect**, in the message offering the buttons:

| Choice | What it says |
|---|---|
| Card payment (online) | licence issued the **same day**, after the payment clears |
| Bank transfer (Virtual IBAN) | licence issued by the **next business day** |

Also ask cold: *"Does it matter how I pay?"* — the knowledge base now has its
own answer for this, in both languages. It had none at all before.

> **One thing to check on your side.** The existing wording tells a Virtual IBAN
> applicant that *the IBAN itself* is issued within one working day, after which
> they transfer and the licence follows. If the IBAN takes a working day to
> reach them, the licence cannot also be issued by the next business day unless
> the transfer clears the same day it arrives. We have written what you asked
> for. Please confirm which of the two is the real commitment.

---

## 5 — Arabic values, extracted and displayed

Two separate faults.

**Not captured.** There was nowhere to put most of them. The application now
holds the trade name in Arabic, the street address in Arabic, the region in
Arabic, the owner's name in Arabic, and **each partner's name in Arabic** — and
sends the last of those to you as `EPG_Partner_Name_Arabic__c`, which is a field
you have always had and we have never once populated.

**Not displayed properly.** An Arabic value in an English session inherited the
panel's left-to-right direction, which throws «ش.ذ.م.م» and any bracket or comma
to the wrong end of the line — the name is right and reads as nonsense. Each
value is now laid out by its own script, both ways round.

**Test** — upload a trade licence and an MOA that print Arabic, then read the
panel on the right in an **English** session. Then the same conversation in
Arabic. Every Arabic value should read correctly in both.

**One rule we were firm about:** if a document does not print an Arabic value,
the field stays **empty**. An Arabic name the assistant translated itself is
worse than a blank, because it looks like it was read off the document.

---

## 6 — The service names

| Where | Now reads |
|---|---|
| opening buttons | Apply for Postal Activity License / Renew Postal Activity License |
| Arabic buttons | التقدّم بطلب رخصة نشاط بريدي / تجديد رخصة النشاط البريدي |
| the application title in the panel | Apply for Postal Activity License |
| the knowledge-base articles it cites | "Postal Activity License eligibility", "Required documents for a new Postal Activity License" |

Nothing is called a "courier license" any more — it was in both intent
descriptions and two article titles.

> You wrote the pair as "New License Issuance" and "Renew License". We have used
> the names in your brackets, which are the ones a customer reads. If the
> left-hand names are what appear somewhere in Salesforce, tell us where and we
> will match it.

---

## 7 — Non-resident partners

**You already model this and we were not using it.**
`EPG_Partner__c.EPG_Residence_Type__c` is your picklist —
`Citizen | Resident | Non Resident` — and `EPG_Emirates_ID__c` beside it is
optional. So the application now records the residence type in exactly those
three words and sends it to you unchanged, and the Emirates ID requirement is
gated on it.

**Test**
1. Start a new licence with two or more partners.
2. When it reaches a partner's Emirates ID, expect three options: **upload the
   card**, **type the number**, or **this partner lives outside the UAE**.
3. Take the third.
4. **Expect** the Emirates ID slot to disappear for that partner — off the
   checklist and out of the readiness count, not greyed out — and the
   application to be able to reach submission without it. Their **passport is
   still mandatory**.
5. Ask cold too: *"My partner lives in Ghana and has no Emirates ID"*. Expect a
   straight yes, not a callback offer.

**Must NOT happen:** a partner treated as non-resident because of their
**nationality**. Most UAE residents hold a foreign passport. A Pakistani or
British partner who lives here should still be asked for their Emirates ID.

---

## 8 — Sole establishments

A sole establishment has one natural-person owner, nobody to contract with, and
no MOA is ever issued for it.

The legal form is now read off the trade licence and recorded using **your own
vocabulary** — `Account.Legal_Type__c`, all fifteen values — and the MOA slot is
conditioned on it.

**Test**
1. Upload a **sole establishment**'s trade licence.
2. **Expect** the legal form in the panel, and the MOA never asked for: not
   requested, not listed as missing, not counted in readiness. Straight on to
   the Emirates ID step.
3. Then an **LLC**'s licence, and expect the MOA asked for exactly as before.

**Deliberately narrow.** Only **"Sole Establishment"** skips it.
**"Limited Liability Company - Single Owner(LLC - SO)"** also has a single owner
and *does* have an MOA, as do Civil Companies and Free Zone Companies. If any of
those should skip it too, tell us which and it is a one-line change each. And if
the licence prints no legal form at all, the MOA is asked for as usual — an
unknown form is not a sole establishment.

---

## Found while testing, not on your list

**The readiness bar was counting the wrong number.** The requirement rules are
evaluated in three places — the server, the chat widget, and the mobile upload
page — and the two front ends never handled the "one document per partner" form
of the rule. So the server counted every partner's passport and Emirates ID
among the requirements and the widget counted **none** of them: the bar the
applicant read and the completeness the submission enforced were different
numbers, for as long as partner documents have existed. There is one
implementation now. Expect the bar to jump by up to sixteen on a multi-partner
application — that is it becoming correct, not a new requirement.

**Two things for you to settle**, both pre-existing and neither changed by us:

1. **The fee.** Six knowledge-base answers say AED 100,000. Production charges
   AED 150,000. One of them is out of date, and it is your published figure in
   your own FAQ, so we have not touched it.
2. **When payment is taken.** The FAQ says the payment request comes *after*
   approval. The assistant takes payment *at submission*, because your *Payment
   Process with Agentic* map shows submit-and-pay in one step. This is the same
   question still open from 9 September, and it is why `Amount (Paid)` reads
   0.00 on a paid request.

---

## What to send us if something fails

The **conversation id**. Everything below is queryable from it: which documents
were required and why, what was read off each upload, what was refused and on
what evidence, and what the panel held at the moment you saw it.
