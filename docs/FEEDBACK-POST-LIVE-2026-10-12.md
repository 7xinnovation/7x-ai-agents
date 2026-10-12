# Post Live Feedback Round — the six open items, 12 October 2026

Source: `feedback-unresolved-structured-2026-10-12.json` (6 unresolved of 76;
the other 70 are in a terminal status). Every item's "Expected" field was empty,
so each was worked from its comment. Status after this pass:

| Ref | Item | Status |
| --- | --- | --- |
| FB-1710 | General PO Box inquiries not answered | **Done** — PO Box FAQ in the knowledge base (EN/AR), answered directly |
| FB-1803 | Inquiry inside the experience, no other website | **Done** — enquiries, complaints and callbacks are raised in the chat with a reference |
| FB-1812 | UAE Pay payment gateway | **Done earlier** (7–11 October) — Noqodi (UAE Pay) live on staging for EPGL and NXN; production awaits credentials |
| FB-1831 | Ready prompt, submit and pay in two steps | **Done** — greeting buttons + a ready prompt that fills the composer; one message → summary + pay |
| FB-1832 | Renew Now with saved card, like Amazon Pay | **Done as far as Emirates Post allows** — one tap saves the order with the saved card attached and opens their payment page; a silent charge needs their tokenised-charge API (ask open since 7 October) |
| FB-1889 | Name the voice and the brand Mira ميره | **Done** — wordmark, greetings, voice instruction, code; interim wordmark pending the designer's asset |

## FB-1710 — the PO Box FAQ

The attachment is NXN's "PO Box Services — AI Chatbot FAQ Knowledge Base"
(June). Its answers describe a menu ("Select: PO Box Services → Individual
Customer → …"), so `scripts/add-nxn-pobox-faq-kb-2026-10-12.ts` rewrites them for
the conversation and checks them against what the chat really does: eleven
topics in English and eleven in Arabic — what the assistant can do and that no
branch visit is needed; personal rental and its bundles; corporate rental;
personal and corporate renewal (Renew pill, card or Noqodi); the authorised agent
(first one included); key delivery (AED 30, the figure confirmed from
GetChargesForAdditionalServices on 1 September, not the AED 25 the FAQ's older
corporate chunk still said — that chunk is corrected too); auto-renewal (on/off
in the chat, needs a saved card); linking (boxes appear from the Emirates ID,
no step); and what to do with anything not covered.

The round's question — answer directly, or route elsewhere? — is answered:
directly, from the knowledge base, and anything it does not cover is raised as
an enquiry in the chat (FB-1803). Asked cold on the local server, the six English
and three Arabic questions tried (key delivery fee, agent fee, cancelling
auto-renewal, branch visit, bundles, linking) were all answered without a hedge
and without a link out.

## FB-1803 — the enquiry stays in the experience

Since 9 September the persona and every journey's guidance sent a customer who
wanted a callback, a complaint, or an answer we did not have to Emirates Post's
enquiry page — because their `/nextApi/case` is CAPTCHA-gated
(`docs/NXN-CALLBACK-BLOCKED-2026-09-03.md`) and the ops mailbox the fallback
needed is set in no environment, so the callback tool failed and the guidance
reached for the link.

Now:

- `request_escalation` is, by its description, the in-chat enquiry, complaint
  and callback. For NXN it still tries Emirates Post's case endpoint first; when
  that cannot be used it **records the enquiry** (an `enquiry_recorded` audit
  row with the details, and the case marked escalated — both on the console),
  emails the ops mailbox when `NXN_BRANCH_OPS_EMAIL` is set, and hands back a
  reference `ENQ-XXXXXXXX`. It no longer throws for a missing mailbox; it logs
  `enquiry_no_mailbox` loudly instead.
- `scripts/nxn-post-live-feedback-2026-10-12.ts` replaces the persona paragraph
  and the five journeys' sentence with the in-chat rule, and rewrites the
  knowledge-base sentences that quoted the page.
- A safety net in `lib/locateGuard.ts` turns any enquiry-page link the model
  still writes, Markdown or bare, in either language, into "ask me here and I
  will raise the enquiry for you in the chat" — on the finished text and on the
  stream.

Verified locally: a guest complaint in English and in Arabic was taken in two
turns (one message asking for name and mobile, then the reference), with no link
in either reply, and both enquiries are on the audit log.

**Action for ops:** set `NXN_BRANCH_OPS_EMAIL` on staging and production so the
team is emailed as well as seeing the console. Until then the enquiry is
recorded and referenced, and visible on the admin console only.

## FB-1831 — a ready prompt, two steps

- The NXN greeting now introduces Mira and offers four buttons: Rent a new PO
  Box, Renew my PO Box, Manage my PO Box, Ask a question (EN/AR). A greeting
  with buttons replaces the starter grid, as FB-1434 established.
- Under it, a **ready prompt** — "Renew my PO Box [number] in [emirate] for one
  more year, same bundle and options." Tapping it does not send: it fills the
  composer with the first blank selected (`prefillComposer` in Experience.tsx).
  The one message the customer sends is the opener the server already
  recognises, so a guest gets identity line + summary + Terms + pay button
  (two steps), and a signed-in customer gets the summary and the payment page in
  one reply. The schema gained `readyPrompts` (label + prompt, localised).
- The persona says what the "Renew my PO Box" button does for a guest: ask for
  the box number and the emirate in one message, then continue as the opener.

## FB-1889 — Mira

- `public/mira-onlight.svg` and `mira-ondark.svg`: an interim wordmark in the
  same language as the AISHA mark (gradient opening letters, navy, sparkle,
  Arabic beneath). **Replace with the designer's final asset; keep the file
  names.** The header uses `mira-onlight.svg`, alt "Mira".
- `scripts/rename-aisha-to-mira-2026-10-12.ts` renames in every agent's
  greeting, persona, guidance, titles and intents (whole words, EN/AR) and in any
  knowledge-base chunk; the deployment's internal `name` stays. On local it
  changed EPGL's two greetings; NXN's greeting is rewritten by the feedback
  script to introduce Mira.
- The voice: `TTS_INSTRUCTIONS` now opens "You are Mira, the spoken voice…".
  The voice reads the reply as written, so it says whatever name the greeting
  says.

## FB-1812 and FB-1832 — already delivered, status only

UAE Pay (Noqodi) is integrated and live on staging for both agents
(`docs/UAEPAY-ROLLOUT-2026-10-07.md`); production needs Noqodi's production
merchant credentials. The one-tap renewal
(`docs/NXN-ONE-TAP-RENEW-FEASIBILITY-2026-10-07.md`) saves the order with the
customer's saved card attached and opens Emirates Post's payment page with it
pre-selected; charging without that page needs an API Emirates Post has not
exposed, which is the open ask to them.

## Verification

- `scripts/test-feedback-2026-10-12.ts`: 28 checks.
- One-tap suite 84 checks, typecheck clean, end-to-end harness 42 (see commit).
- Live on the local server: complaint EN/AR → `ENQ-` reference, no link; nine
  FAQ questions answered directly; greeting and ready prompt served by
  `/api/agents/nxn-dialog`; EPGL greets as Mira.

## Applying to an environment

From `apps/web`, against the environment's env file:

```
npx tsx scripts/rename-aisha-to-mira-2026-10-12.ts --env <file>
npx tsx scripts/nxn-post-live-feedback-2026-10-12.ts --env <file>
npx tsx scripts/add-nxn-pobox-faq-kb-2026-10-12.ts --env <file>
```

All three are idempotent. The knowledge base is full-text searched in every
environment (no `VOYAGE_API_KEY` anywhere), so no embeddings are needed.

**Where Noqodi (UAE Pay) is switched off** — production, until its credentials
land — the FAQ names the card alone, the one-tap config script writes the
guidance and the payment field without the Noqodi clauses, and the per-turn
directive offers no Noqodi button (a Noqodi tap is answered "not offered here").
All of it follows the agent's `paymentMethods` switch, so the day Noqodi is
switched on there, re-running the three scripts brings the second way to pay
back without a code change.
