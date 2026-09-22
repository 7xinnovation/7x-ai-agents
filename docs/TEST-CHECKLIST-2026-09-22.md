# Test checklist — 22 September

Everything below is on **staging** and not yet on production.

- EPGL: https://7xagents.7x-lab.com/embed/epgl-dialog
- Emirates Post: https://7xagents.7x-lab.com/embed/nxn-dialog

---

## EPGL

| # | Do this | Should happen | Was |
|---|---|---|---|
| 1 | Submit an application, then press **Check status again** two or three times | The reference stays the same every time | LR-37425 → LR-37427 |
| 2 | Ask anything answered from the knowledge base — fees, documents, timelines | No "§" references anywhere in the reply | "EPGL Agentic AI KB §4" shown to the customer |
| 3 | Upload the wrong file for a document (e.g. an Emirates ID where a passport is asked for) | The red error appears **once**, on the newest card only | Same error on two cards, one above the other |
| 4 | Ask to speak to someone / request a callback | A case is created and you get a reference | Collected phone and email, then failed |
| 5 | Choose **bank transfer (VIBAN)** and finish | The confirmation email says EPGL will send you the Virtual IBAN | Email said only "Payment: Bank transfer" |
| 6 | Check the status when nothing has changed | Says it hasn't moved, gives a realistic timeframe, offers something besides checking again | Same lone button every time |
| 7 | Switch to Arabic and start a flow | Progress lines read «جارٍ التحقق من …», not «جارٍ جلب …» | — |

---

## Emirates Post

| # | Do this | Should happen | Was |
|---|---|---|---|
| 8 | Switch to Arabic and ask for available PO Box numbers | The reply says «سأعرض لك», not «سأجلب» | Reviewer asked for this wording |

---

## Needs a fresh EPGL application to see

| # | Do this | Should happen | Was |
|---|---|---|---|
| 9 | Submit a **new licence** and pay | Request stays in review — it does **not** jump to "Closed" | Went to Closed within seconds, unreviewed |

This one is half ours. We no longer tell Salesforce a payment arrived when there
is no payment advice to record it against, which is what tripped the close. The
`Payment Verified → Closed` step itself is inside EPGL's workflow and changed on
their side between 16 and 21 September — worth asking them about separately.

---

## Already on production (no need to retest, unless you want to)

| Where | Fix |
|---|---|
| EPGL | Callback cases now work in production — permission set assigned, verified |
| EPGL | Licence fee active at AED 100,700, penalties added on top for renewals |
| Both | Mobile: cropping, card buttons, receipt sharing, sign-in, new chat keeping you signed in |

---

## Still open, nothing to test

- **Fee mismatch.** We charge AED 100,700; EPGL's own invoice is AED 100,000. A new licence raises no invoice at all.
- **Renewal without AFS.** Waiting on EPGL about `EPG_Extension_Reason__c` and how these should be flagged.
- **Blocklist.** 2 of the 36 uploaded companies will never match, because the spreadsheet has no licence numbers and those two names differ from Salesforce.
