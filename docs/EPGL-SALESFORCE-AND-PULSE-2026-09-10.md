# EPGL — Contact fix and Customer Pulse

**Applied to staging** · 10 September 2026 · both from Salesforce's 9 Sep reply

Two things landed together: the Contact validation that was rejecting every
submission, and the Customer Pulse survey, which had been built since 31 August
and waiting only on linking ids.

A third thing came out of testing them, and it is the most serious of the three.

---

## 1. The Contact rejection is fixed, and it was ours

Every submission was failing on:

```
Rolled back due to allOrNone=true:
Either of Is Primary Contact or  Is Secondary Contact should be selected
```

That message reads like a missing flag. It is not one, and setting the flag was
never going to work — both fields are read-only to our integration user.

**What was actually wrong.** Their swagger says it in two words each, and I had
read past both:

| Object | Their description | Their handler marks it |
|---|---|---|
| `User` | "Portal applicant." | **Primary** |
| `Contact` | "Secondary contacts." | **Secondary** |

They are two objects for two different people. We were putting the applicant's
own email in `NewContact`. Salesforce matches Contact on Email, found the Primary
contact an earlier submission had already made for that same person, and tried to
mark it Secondary as well. One person cannot be both. The rule was right and we
were wrong.

**What changed.** We no longer state the designation at all — their handler owns
it — and a `NewContact` row whose email matches `NewUser`'s is dropped before the
payload leaves us. `Is_Secondary_Contact__c` replaces the non-existent
`Secondary_Contact` and is sent as their string enum rather than a boolean.

**Proof it works.** A full application ran on staging against the same company
that failed yesterday — YI FANG TAIWAN FRUIT TEA, trade licence 697670, Account
`001FW008rZxmmqyYQA`:

```
NewAccount           200  success=True  001FW008rZxmmqyYQA
NewPartner1          200  success=True  a16FW000BZuVWkCYYW
NewPartner2          200  success=True  a16FW000BZuZitEYYS
NewPartner3          200  success=True  a16FW000BZudv2GYYQ
NewUser              200  success=True  005FW002jJs1VQmYQM
NewMember            200  success=True  a3jFW000293lrseYAA
NewLicenseRequest    200  success=True  a11FW000WygZxzMYIS   → LR-37286
```

All eight documents attached. No `NewContact` was sent at all — one contact
person means one record, and their handler makes it Primary.

### What to test

1. Run a new licence through to submission with **only one contact person**.
   → It submits. No "Either of Is Primary Contact…" anywhere.
2. Do it again with a **second, different** contact person named.
   → Both go: the applicant as the portal user, the other as a secondary contact.
3. Use the **same email** for both on purpose.
   → Still submits. The duplicate is dropped rather than sent.

### Still open with EPGL

We send `EPG_Request_Status__c: "Pending Payment"` on the Virtual IBAN branch and
the composite accepts it — but reading the request back gives **"Under document
review"**. Their handler overrides it. So a VIBAN application that has not paid
is currently indistinguishable from one that has. We need the picklist value they
want for "submitted, awaiting the Virtual IBAN".

---

## 2. Customer Pulse is on for EPGL

Built on 31 August, dormant since, waiting for linking ids. They arrived with the
Postman collection.

**Their ids are not Emirates Post's.** The two agree on the entity (Q) and the
survey (C) and differ on everything that matters:

| | Emirates Post | EPGL |
|---|---|---|
| Channel | `kn` | `kK` |
| Main service | `D2` | `Dt` |
| Sub-service | UP / UU / UQ / UV | **TZ** new · **Ta** renewal |

One shared setting served both before this, so switching EPGL on as it stood
would have filed every licence survey against the PO Box channel. EPGL now reads
its own settings and falls back to the shared ones.

**It fires on submission, not on payment.** That is what their own portal does —
the call comes from `saveNewLicenseRequest`, the first submit out of Draft — and
it is the only thing that works for Virtual IBAN, which never pays in the
conversation at all. Emirates Post stays payment-gated, which is what they asked
for.

**Verified against the government sandbox**: both calls return 201 for TZ and Ta,
with real tokens minted through our own code path.

Also fixed on the way: `transaction/create` was omitting
`sub_service_linking_id`, which their schema marks required. The sandbox issues a
token without it, which is why nobody noticed — but it is the only thing
separating a new licence from a renewal in their reporting, and Emirates Post's
four PO Box services from each other.

### What to test

1. Complete a **new licence** application on staging (either payment method).
   → A survey modal appears a couple of seconds after the confirmation.
2. Do the same on the **Virtual IBAN** branch, where nothing is paid.
   → The survey still appears. This is the branch that had none before.
3. Complete a **PO Box rental** on Emirates Post.
   → Unchanged: the survey still appears after payment, not before.
4. Close the survey without answering.
   → Nothing breaks; the application is complete either way.

If a survey does not appear, nothing is wrong with the application — it is
best-effort by design and never mentioned to the customer.

---

## 3. Found while testing: seven licence requests for one application

This one was not on the list. It surfaced because the card branch had never been
run end to end, and the Virtual IBAN branch hides it completely.

`request_payment` refuses to open a card until the thing being paid for exists,
and it decides that by reading the case's reference. Nothing but the internal
submission step was writing that field — and a licence submits through Salesforce
instead, which recorded the reference for the audit log and left the case saying
nothing had been submitted.

So: the agent submits, asks for payment, is told *"call the submission tool
first"*, obeys, asks again, is told the same thing.

One run created **seven licence requests**, attached all eight documents to each
of them, never reached the payment card, and finished by telling the customer
their browser was probably broken.

Fixed in two places. The reference is now written the moment Salesforce confirms
it. And a second create-shaped submission is refused outright once one has
succeeded — amending an application still works, since that is a real thing a
customer does, but a duplicate create never is.

### What to test

1. Run a new licence to the end choosing **card**.
   → The payment card appears. One licence request, not several.
2. Check the reference the agent quotes.
   → It should be the same one throughout, never a new one each message.
3. Ask to **change a detail** after submitting.
   → It should update the existing application, not create another.

---

## Where things stand

| | Status |
|---|---|
| Contact validation | **fixed** — submits cleanly on the account that failed |
| Customer Pulse, new licence | **on** — sandbox, fires on submission |
| Customer Pulse, renewal | **on** — sandbox, fires on submission |
| Duplicate submissions | **fixed** — one create per conversation |
| `getRequestStatus` 404s | **fixed** — the id is filled in |
| VIBAN status value | **waiting on EPGL** — theirs overrides ours |
| Production | **not touched** — staging only, as usual |

Customer Pulse for EPGL points at the government **sandbox**, using the key from
their Postman collection. Production needs their production key and ids before it
goes anywhere near live.
