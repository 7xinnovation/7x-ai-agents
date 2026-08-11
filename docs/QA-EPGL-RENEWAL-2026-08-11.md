# EPGL QA — Renewal AI Process Feedback (2026-08-11)

Eight items. **Six are implemented and verified. One is out of our hands
(item 3, OTP). One is infrastructure (item 5, response time).**

Test on the EPGL agent, renewal journey: `/embed/epgl-dialog`.

```bash
cd apps/web
npx tsx scripts/verify-epgl-renewal-feedback-2026-08-11.ts   # 33 checks, no server
npx tsx scripts/live-epgl-renewal-2026-08-11.ts              # 8 checks, needs the app
```

---

## 1. Batch document uploads — done

Every document the renewal needs is now listed in one message with its own
upload control beside it, so files can be sent in any order and in batches.

**Test:** start a renewal. The first reply should list the trade/postal licence,
Form 9, AFS and the acknowledgement letter together, with an upload box for each
and mandatory vs optional marked. Upload them out of order — that should be fine.

**Note this reverses FB-1565** from last week, which asked for one clear step at a
time and led to a one-upload-per-message cap. The cap is removed and the
one-at-a-time rule dropped **from the renewal journey only** — a new licence
application still walks one document at a time. Say the word if you want new
licence applications batched too.

---

## 2. Stronger validation and cross-checking — done

Two separate holes, both closed:

**A Form 9 could pass as a trade licence** because the classifier had no name for
it — an official-looking document got mapped to the nearest type it knew. Form 9,
Audited Financial Statements and acknowledgement letters are now first-class
document types, and the classifier is told how to tell them apart from a licence
(a licence grants a right to operate; a Form 9 reports revenue).

**A valid document from the wrong company was accepted.** Uploads are now
cross-checked against what the application already holds — trade licence number,
postal licence number and company name. A mismatch is rejected and none of its
data is applied.

**Test:**
1. Upload a Form 9 into the trade licence slot → rejected, saying it looks like a
   Form 9, not the requested document.
2. Upload a valid MOA into the trade licence slot → rejected as the wrong type.
3. Upload a trade licence for company A, then a Form 9 for company B → the second
   is rejected for not matching the company on the application.
4. After each rejection, confirm the agent re-offers that upload and does **not**
   claim the document was received.

Company-name matching tolerates abbreviations (`Al Noor LLC` vs `Al Noor Trading
L.L.C.` is not a mismatch); it only rejects genuine disagreement.

---

## 3. OTP verification on email and phone — NOT DONE

This one needs a decision and a supplier, so I have not built half of it.

- **Email OTP** is buildable now — Resend is live and sending.
- **Phone OTP is blocked**: there is no SMS provider connected to this platform.
  It needs an account and credentials (Twilio, Unifonic, an Etisalat/du gateway,
  or whatever EPGL already uses for its portal).

Building email-only OTP would leave the spam-application hole open on the phone
side while looking solved, so I would rather you pick:

1. Email OTP now, phone OTP when an SMS provider is available.
2. Wait and do both together.
3. Reuse whatever the EPGL portal already sends OTPs through — tell us which and
   we integrate against it.

---

## 4. UAE phone formatting — done

Phone fields now enforce UAE telecom standards: mobile `05x xxx xxxx` /
`+9715x xxx xxxx` (5 followed by 0, 2, 4, 5, 6 or 8) and landline `0x xxx xxxx`.
Spaces, dashes, `+971` and `00971` are all accepted on input; the number
underneath has to be real. Applied to the accountant's phone, the contact phone
and the owner's contact number.

**Test:** give `+44 7700 900123` → refused, asks for a UAE number, and does not
silently reformat it. Give `0511234567` (invalid UAE prefix) → refused. Give
`050 123 4567`, `+971501234567` and `04 234 5678` → all accepted.

---

## 5. Response time — infrastructure, being addressed separately

Measured against production: EPGL answers in **2.6–5.4 seconds**, which is
healthy. The slow agent is NXN, which swings between 3 and 61 seconds — the stall
sits inside a backend tool round, and NXN carries 21 tools against EPGL's 4.

One real bug behind the "slow" feeling **is** fixed and deployed: when a browser
dropped the connection mid-answer, the turn was aborted before anything was
saved, so the customer had to repeat themselves. That is fixed.

The rest is expected to improve with the planned move to Azure.

---

## 6. Finance summary — quarters follow the licence, not the calendar — done

This is the bug in the screenshot. The agent assumed the four quarters were
calendar Q1–Q4 and kept asking for "Q1" even after being told the first quarter
was Q3 2023 — then mapped the year wrongly (Q1 2023, Q2 2023, Q3 2023, Q4 2024).

Now: the period's starting quarter is captured, the four figures mean the 1st to
4th quarter **of that licensing period**, and every quarter is named in full with
its calendar label and year. Salesforce still receives the true calendar quarter
and year on each finance row — the derivation is spelled out in the submission
mapping, so a Q3 start writes Q3 2023, Q4 2023, Q1 2024, Q2 2024.

**Verified live** — telling it the licence period runs from July 2023 produces:

> 1st quarter: **Q3 2023** (Jul–Sep 2023) · 2nd: **Q4 2023** · 3rd: **Q1 2024** ·
> 4th: **Q2 2024**

**Test:**
1. Say your licence period starts in July 2023 → it should derive the four
   quarters above without asking you to correct it.
2. Say "my first quarter is Q3 2023, revenue 2000000" → it should record that and
   move to **Q4 2023**, not ask for "Q1" again.
3. Try a January start → it should produce plain Q1–Q4 of one year.

**Also done: figures are read, not dictated.** Once the Form 9 is uploaded the
four figures are taken from it and shown together in one summary with a single
confirm-or-change question, instead of four separate prompts. You are only asked
to type a figure that is genuinely missing or that you want to correct.

---

## 7. Financial year — done

The financial year is now defined and labelled as *the year the licensing
period's first quarter falls in*, and the agent is told the same rule.

**Test:** a period starting Q3 2023 should give financial year **2023**, not
2023-2024 or 2024.

---

## 8. Revenue documents — done

**Form 9** and **Audited Financial Statements** are now mandatory renewal
documents; the **audit acknowledgement letter** is accepted as optional. These
are what let EPGL confirm the audit is complete rather than leaving the request
partially closed, and the agent explains that if asked.

**Test:** start a renewal and confirm all three are requested, that Form 9 and
AFS are marked mandatory, and that the readiness/submission is blocked while
either is missing.

**One thing worth knowing:** the agent's guardrails list "Form 09" as a refusal
topic. That was there to stop it advising on how to complete one, but it risked
refusing to handle the document at all. The guardrail is unchanged — the agent is
now explicitly told it may request, receive and read a Form 9, and that the
refusal only covers advising on its content. Test this: ask *"how should I fill in
my Form 9?"* — it should decline to advise but still accept the upload.

---

## Not sent to Salesforce

The pinned coordinates from the previous round and the new period-start quarter
are stored on the application. The quarter derivation **is** carried into the
Salesforce finance rows. Nothing else new goes to Salesforce — the payment,
company-profile and IDEP items are still waiting on that contract (see
`reports/EPGL-Salesforce-API-Requests.md`).
