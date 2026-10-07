# "Pay with Card" or "Pay with Noqodi (UAE Pay)" — where it stands, and the production runbook

*7 October 2026. Decision: every agent offers the card (Network International, as
today) and Noqodi — the federal UAE Pay platform — as a second way to pay, under
those two names. Noqodi runs on UAT (staging) until production credentials arrive;
this is what is built, what is live where, and the exact steps that remain.*

---

## 1. What is built (all on `staging`)

| Piece | Where | Since |
|---|---|---|
| UAEPay adapter — create link, inquiry, token per call | `packages/core/src/adapters/uaepay.ts` | 2 Oct |
| A gateway per payment method, chosen by the customer's `payment_method` | `integrations.paymentGateways`, `registry.ts`, `lib/paymentGateway.ts` | 2 Oct |
| `payments.provider` — which gateway holds the money | `packages/db/src/schema.ts`; column exists on **staging and production** | 2 Oct |
| A switch per method, per agent, per environment | `definition.paymentMethods`; admin → agent → payments tab | 2 Oct |
| `request_payment` refuses a switched-off method; the model is told what is on | `tools.ts`, `chat/route.ts` | 2 Oct |
| Secure redirect: only `merchantRequestId` + `status` come back; inquiry for the rest | adapter | **7 Oct** |
| Hosted page in the conversation's language; service name in the UAE Pay app | adapter | **7 Oct** |
| Return page answers a POST redirect like a GET | `api/payments/return` | **7 Oct** |
| Pay button may open `*.uaepay.ae` / `*.noqodi.com` | `Markdown.tsx` PAY_HOSTS | **7 Oct** |
| Customer names: "Pay with Card", "Pay with Noqodi (UAE Pay)" | admin switches, field options, guidance | **7 Oct** |
| One rollout script for any agent, any environment, idempotent | `scripts/uaepay-rollout-2026-10-07.ts` | **7 Oct** |
| Live UAT smoke test (AED 1 link + inquiry, nothing paid) | `scripts/test-uaepay-live-2026-10-07.ts` | **7 Oct** |

Tests: `test-uaepay-2026-10-02.ts` (34), `test-payment-methods-2026-10-02.ts` (29),
`test-uaepay-rollout-2026-10-07.ts` (51), live (5) — all green on 7 October.

## 2. Where it is live

| | EPGL | NXN (Emirates Post) |
|---|---|---|
| **Staging** | **ON.** Three choices: Pay with Card (fee + AED 1,000 online fee), Pay with Noqodi (UAE Pay) (fee), Bank transfer (Virtual IBAN) (fee). UAT merchant MR123093. | **Prepared, OFF.** Switch present and off, UAT binding written. No choice in chat — see §4. |
| **Production** | "Pay with Card" + Virtual IBAN; Noqodi switch present and **off**, no binding, no credentials (code deployed 7 Oct, dormant). | "Pay with Card" only; Noqodi switch present and **off**. |

Staging credentials live in the staging App Service as `UAEPAY_CLIENT_ID` /
`UAEPAY_CLIENT_SECRET` (developer-portal application "7xtest"). They are UAT only:
`api.uaepay.ae` rejects them.

## 3. Production runbook — when Noqodi's production onboarding arrives

Needed from Noqodi / UAE Pay first: a **production** client id and secret, the
**production merchant code**, and (optional, for later) beneficiary account numbers
and child merchant codes. Ask at the same time how a **webhook is authenticated** —
the guide never says, so we confirm every result through the inquiry API instead.

1. **Code to production — done 7 Oct 2026.** `main` is merged from `staging`
   routinely ("Merge branch 'staging'", most recently on 2 October), so production
   already carried the 2 October UAEPay code; on 7 October `staging` was merged
   again with the day's hardenings and the GitHub Action deployed
   `app-7xil-agents-prod`. Dormant on production: no switch list, no binding, no
   credentials. For any later change, repeat:
   ```sh
   git checkout main && git pull --ff-only && git merge origin/staging && git push origin main
   ```
   Migrations do **not** run on deploy; `payments.provider` already exists on
   production (verified 7 Oct), so none was needed. Pre-deploy checks run on
   7 Oct: no other schema change since production's build, deploy workflow
   unchanged, and every app setting the code requires is present on production.
2. **Credentials on the production App Service** (restarts the app):
   ```sh
   az webapp config appsettings set --subscription sub-7xil-prod \
     --resource-group rg-7xil-external-prod --name app-7xil-agents-prod \
     --settings UAEPAY_CLIENT_ID=<prod id> UAEPAY_CLIENT_SECRET=<prod secret>
   ```
3. **Prove the credentials** before touching any agent (creates one unpaid AED 1 link):
   ```sh
   cd apps/web && UAEPAY_CLIENT_ID=… UAEPAY_CLIENT_SECRET=… \
     npx tsx scripts/test-uaepay-live-2026-10-07.ts --base-url https://api.uaepay.ae --merchant <PROD MERCHANT>
   ```
4. **Switch EPGL on.** Prices are read from the journey, so production states
   AED 101,000 card / 100,000 Noqodi / 100,000 Virtual IBAN by itself.
   ```sh
   npx tsx scripts/uaepay-rollout-2026-10-07.ts --env <prod env file> --agent epgl-dialog \
     --host https://agent.7x.ae --base-url https://api.uaepay.ae --merchant <PROD MERCHANT> --enable
   ```
   Add `--dry-run` first to see the plan. The script refuses the UAT gateway on a
   production agent, so the merchant must be the production one.
5. **Check** on agent.7x.ae: the payment question offers three buttons; a Noqodi
   payment opens `pay.uaepay.ae`; the admin switch shows Noqodi on.
6. **Rollback is a switch, not a deploy:** the same command without `--enable`
   turns it off, removes the option and cuts the guidance. Nothing else changes.

A local run against production needs this Mac on the database firewall
(`atoum-mac-<date>` rule on `psql-7xil-external-prod`) — added 7 Oct for this IP;
re-add if the address changes.

## 4. NXN — why the chat cannot offer Noqodi yet, and what would unblock it

Emirates Post's rentals and renewals pay on **Emirates Post's own** gateway:
`Rental/Save` and `Guest/Renewal/Save` create the order and open the payment on
their N-Genius outlet, and `UpdatePayment/{referenceNumber}` /
`ConfirmPayment(paymentReferenceNumber)` check **that** gateway. Their API (spec
`EP.Retail.Product.BackEnd.API V1`, read 7 Oct) has no way to choose a gateway
and no way to record a payment taken elsewhere. A Noqodi payment we took would be
money with no order behind it on their side — the failure of 8 September again.

So NXN has the switch (off) and the binding, and `--enable` refuses with that
reason. What unblocks it is one of two things from Emirates Post, written up in
`docs/NXN-UAEPAY-ASK-2026-10-07.md`: their backend returning a UAE Pay link
(nothing further for us — the hosts are already allowed), or an endpoint that
accepts an external payment reference.

## 5. Open with Noqodi / UAE Pay

- Production onboarding and credentials (blocks §3).
- How a webhook is authenticated (until answered, inquiry is the truth).
- Child merchant codes, if Finance want the licence fee and the online fee
  settled as separate lines (`DUPLICATE_MERCHANT` otherwise).
- Documentation: the Sale Integration Guide v1.4 PDF is the only real reference;
  `docs.uaepay.ae` is a placeholder cloned from Stripe's docs landing page.
