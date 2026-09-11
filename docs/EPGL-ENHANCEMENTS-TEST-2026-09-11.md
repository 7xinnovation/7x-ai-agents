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

# Part two — the consolidated testing feedback

Everything below is from *Agentic AI Testing Feedback — Consolidated 11 Sept*,
and is on staging alongside the eight above. **Six items are not done and the
reasons are at the end** — they are decisions rather than changes.

---

## The fee is AED 150,000

Six knowledge-base answers said 100,000, in both languages, against a gateway
that charges 150,000. An applicant quoted one figure and charged another finds
out at the payment page. All six now say 150,000; the 10% levy on leviable
services and the AED 2 per shipment are separate charges and are untouched.

**Test** — ask *"what does the licence cost?"* in both languages, and again from
inside an application.

## One business day, eight working hours

**Test** — ask *"how long does it take?"*. Expect *"1 business day (8 working
hours)"*, and «خلال يوم عمل واحد (8 ساعات عمل)» in Arabic.

## The login requirement — there isn't one

You asked us to clarify it. Measured: **neither journey requires
authentication** — not the intent, not any step, and not the submission. A
licence application goes through signed in or not. The only thing that genuinely
needs a sign-in is **checking the status of an existing application**, which
reads someone's records back to them.

What you were seeing was a sign-in prompt on the first turn of a new licence,
**about one conversation in three**, because it was raised on the assistant's
own judgement and its judgement varied. Writing the rule into the guidance was
not enough — three identical openings gave two clean runs and one prompt — so a
journey that does not require sign-in can no longer have it demanded. Five
consecutive runs afterwards, all clean.

**Test** — start a new licence five or six times. **Expect no sign-in prompt at
any point**, including at submission. Signing in stays available from the header
and is mentioned once as optional (it links the application to your account so
you can track it).

## A trade licence *or* an initial approval

Your screenshot showed *Initial approval number 1777380* in the details and
**Trade license number** still unticked in Submission Readiness — a requirement
that applicant could never meet.

The trade licence number is now required **only while the initial approval
number is empty**. Two fields, one of which bites only when the other is blank.

**Test** — apply with an initial approval and no trade licence. Expect readiness
to reach complete without a trade licence number, and the assistant to say the
licence number is not needed until the licence is issued.

## Identity numbers are masked

`784-1990-4193131-4` now renders as `•••-••••-••••131-4`.

The tension is worth naming: the panel exists so you can **check** what was read
off your documents, and a value masked to nothing cannot be checked. Four
characters is enough to tell your own card from a misread digit and not enough
to be an identity document. The assistant confirms them the same way in chat —
*"the Emirates ID ending 131-4"*.

**This is presentation only.** The application holds the real value and EPGL
receive it in full. The correction pencil edits the real one, not the mask.

## The MOA is optional, and the lease contract has a slot

- **MOA** — optional everywhere now, and still absent entirely for a sole
  establishment (it is not "skippable" there, it does not exist).
- **Lease contract** — added to both journeys, **optional**, offered once at the
  end of document collection for the location check.

> The lease contract is optional **deliberately**. It is in your published
> requirements, but making it mandatory mid-UAT blocks applications that are
> otherwise complete. One word to change if you want it enforced — tell us.

## Non-resident partners: not the number either

Yesterday's change dropped the Emirates ID **document**. It now drops the
**number** as well — not asked for, not counted, and omitted from the submission
rather than sent empty. Same for the owner, when the owner is the non-resident.

## The renewal's three acknowledgments

You saw one checkbox where three were expected. There are three now — the terms
and conditions, the approved commitment form, and the mandatory IDEP integration
— each ticked separately, each timestamped separately, each mapped to its own
field (`EPG_Terms_and_Conditions__c`, `Approved_Commitment_Form__c`,
`Mandatory_integration_with_IDEP__c`). The Declaration & Undertaking is the
fourth line and was always separate.

**Test** — reach the end of a renewal. Expect four tick-boxes, and submission
refused while any of them is unticked.

## The card comes first

Both options are always offered, but they are not equivalent: the card has the
licence issued the **same day**. So the card is presented first, as the
recommended route, with the Virtual IBAN second — and a customer who picks the
transfer is now told, in the message confirming submission, that **the Virtual
IBAN will be added to their workspace** as well as emailed.

## "Ask a question" no longer starts an application

Pressing **Ask a question** and then saying *"applying for a new licence"* was
opening the journey and asking for a name, an email and a document. That was a
topic, not a decision.

**Test** — Ask a question → "applying for a new licence". Expect a short menu
(*what documents are needed / what are the steps / how long / what it costs*),
an answer, and then an explicit *"shall I start the application?"*. Pressing the
opening **Apply for Postal Activity License** button still starts it straight
away, as it should.

## Language consistency

Your first screenshot has an Arabic panel beside an English conversation. The
widget now follows the language the customer is actually writing in, both ways —
verified on EPGL today: an English message on an Arabic page switches the whole
interface to English, an Arabic message on an English page switches it to
Arabic, and a bare "ok" changes nothing either way.

---

## Six things we did not change, and why

1. **Save and resume.** A case already survives a page reload in the same
   browser. Resuming from another device, or next week, means knowing who the
   applicant is — which runs straight into the login question above, where the
   answer is currently "no sign-in required". Tell us which you want and we will
   build to it; it is a feature, not a wording change.

2. **New licence: review then pay. Renewal: pay then review.** This reverses the
   order the whole submission is built around, and it is the same question still
   open with Salesforce since 9 September — the reason `Amount (Paid)` reads
   0.00 on a paid request. We built submit-and-pay-together from your *Payment
   Process with Agentic* map. **Please confirm this in writing and we will
   change it**, but not on a bullet in a feedback document while the Salesforce
   side says something else.

3. **"The requirements in the journey differ from the website."** We need the
   website's list beside ours to align them. Send the page or the list and this
   is quick.

4. **Uploads: all three at once on phone, one at a time on laptop.** The
   one-at-a-time rule in chat is **FB-1565 — your own request from 10 August**.
   The panel on the right already lets you upload any slot at any time on a
   laptop. Which behaviour do you want in chat? We will not reverse a rule you
   asked for without you asking.

5. **"A new application with the same details gets into a loop."** We have not
   reproduced this. Send the **conversation id** and we will — there is a
   duplicate-check step before submission and it is the likely culprit, but
   changing anything around it blind risks letting real duplicates through.

6. **Consolidating 11/18 into four stages** (Data, Documents, Review, Payment &
   Issuance) is a panel redesign rather than a content change, and is not in this
   batch. Noted and queued.

> One number will move on its own: the readiness total. See the note below about
> the requirement count having been wrong — expect it to jump on a multi-partner
> application. That is it becoming correct.

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

1. **The fee.** Settled on 11 September — the figure is **AED 150,000** and all
   six knowledge-base answers now say so.
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
