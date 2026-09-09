# Staging test — Day 2 bug log items

Covers the second section of **NXN PO Box Agent Bug list (8th September)**.
Staging only: `https://7xagents.7x-lab.com/embed/nxn-dialog`

Separate from `STAGING-TEST-2026-09-09.md`, which covers the widget, the Arabic
strings and the EPGL work. No overlap — run either on its own.

**Hard-reload first** (⌘⇧R). Several of these are UI changes and a cached bundle
will show you yesterday's build.

---

## #6 — The source chips now say what they are

**Was:** `NXN Services Guide §7` floating under a reply with no label, reading
like an internal reference that had escaped into the chat.

1. Ask a knowledge question — *"what do I need to rent a PO Box?"*
2. Look under the answer.

**Pass:** the chips are preceded by a small **SOURCES** label (**المصادر** in
Arabic), and hovering a chip shows the same word.

**Fail:** bare chips with nothing to explain them.

---

## #2 — Recent Activity reads like a sentence

**Was:** `NXN-B295AF15: Manage PO Box, 07-09-2026`

1. Sign in with UAE PASS on an account that has completed requests.
2. Wait for the Account Pulse, and read the "Recent activity" lines.

**Pass:** each line says what was done, to which box, and when — e.g. *"You added
an authorised agent to box 450866 on 7 September"*. A reference may appear **at
the end, in brackets**.

**Fail:** a line that opens with `NXN-…`.

Check it in Arabic too — it was reported in both.

---

## #3 and #4 — No more controls that don't exist

**Was:** *"Tap the attachment / location icon in the chat input bar"* — there is
no such icon. And in Change Address, the agent asked for a map pin over and over
without ever giving one, ignoring the branch already chosen.

1. Start **Manage existing PO Box → change address**, or any flow that asks where
   you are.
2. Read the wording carefully.

**Pass:**
- A location request comes with a **button you can actually press**, not a
  description of an icon.
- If you ignore it and reply in words, the agent **accepts a typed address**
  rather than asking for a pin again.
- It does not ask for a branch or area you have already given it.

**Fail:** any sentence telling you to tap, click or find something in the
interface. There is no attachment icon, no paperclip, no location button in the
input bar — if the agent mentions one, that is the bug.

---

## #13 — A confirmed application can no longer be edited

**Was:** every field in "Your application" kept its edit pencil after the
application was confirmed and the terms accepted — so a detail the order had
been placed on could be changed silently, with no re-confirmation.

**Before submitting** — pencils should still work. That is the point of them.

1. Start a rental and let the panel fill in.
2. Edit a contact detail with the pencil. **Pass:** it saves.

**After submitting or paying:**

3. Complete a submission, or take a payment through to paid.
4. Look at the panel.

**Pass:** the pencils are **gone**. Every value is read-only.

5. If you want to be thorough, try it through the API while the case is settled:

```bash
curl -s -X POST https://7xagents.7x-lab.com/api/case/field \
  -H 'Content-Type: application/json' \
  -d '{"agentSlug":"nxn-dialog","conversationId":"<the settled one>","key":"contact_phone","value":"0500000000"}'
```

**Pass:** `409` with `{"error":"case_already_settled"}`.

That second check is the one that matters — hiding a pencil is not enforcing a
rule, and the endpoint used to accept the edit regardless.

---

## Already fixed earlier, same list — worth re-checking

| # | Was | Now |
|---|---|---|
| Day 2 #9 | "Track a shipment" link 404'd on `/track` | goes to `/all-services/track-a-package` |
| Day 2 #12 | "Raise an enquiry" stuck on "loading…" | it was the **staging** URL on production; now the live page, and the Arabic page in Arabic |
| Day 1 #5 | "Browse nearby branches on a map" stayed English | Arabic |

---

## Not changed, and why

**Day 1 #14 — auto-renewal starting ON.** Confirmed by Emre on 9 September: it
**stays on**. The UAT note reports it as consent taken without asking, but it is
a deliberate request from 27 August so that customers tap Proceed rather than
flip two switches. **Please do not re-report it.** What must remain true is that
a switch the customer turns OFF is recorded as off — worth checking once, by
turning auto-renewal off and confirming the confirmation says No.

**Day 2 #11 — a declined card reading as "pending".** The detection exists and
the wording is right ("the card was declined, nothing has been charged, use a
different card"), and the gateway credentials are configured — so this should
already work and I could not reproduce the reported behaviour without a real
decline. **Please retest with the sandbox decline card `4596035679045649`** and
send me the conversation id if it still reads as pending.

**Day 2 #7 / Day 1 #11 — "Reopen payment page" opening a dead link.** N-Genius
payment sessions are single use; once used, the original link genuinely no longer
exists, so reopening it cannot work. Their own note #8 confirms the recovery path
— "set up a fresh payment page" — works. The real fix is for that button to mint
a new session instead of reopening a spent one. Not done; say the word.
