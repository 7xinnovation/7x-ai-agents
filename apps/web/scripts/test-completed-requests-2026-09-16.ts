/**
 * The completed-requests tab, against a real database.
 *
 * Asked for on 16 September: a tab per agent showing the confirmed summary of
 * every completed request "alongside how we send it to Salesforce". Two things
 * here are worth a test rather than a screenshot:
 *
 *  - WHAT COUNTS AS COMPLETE. A licence paid by Virtual IBAN is submitted and
 *    unpaid for days; a PO Box renewal is paid with no separate submission. A
 *    list that only knew one of those would quietly omit a third of the work.
 *  - THE CONFIRMATION IS READ BACK, NOT REBUILT. The card in the panel is the
 *    one the customer was shown, parsed out of the transcript. If it were
 *    rebuilt from the case, a disagreement between the two — the thing anyone
 *    reconciling against Salesforce is looking for — would be invisible.
 *
 * Read-only: it runs the same queries the admin panel runs and writes nothing.
 *
 * Run from apps/web, against a local env file or an inherited DATABASE_URL:
 *   npx tsx scripts/test-completed-requests-2026-09-16.ts --env ../../.env
 */
import { databaseUrlFrom } from "./lib/envFile";
const i = process.argv.indexOf("--env");
if (i !== -1) process.env.DATABASE_URL = databaseUrlFrom(process.argv[i + 1] ?? "");
if (!process.env.DATABASE_URL) throw new Error("--env <file>, or a DATABASE_URL in the environment, is required");

import { readFileSync } from "node:fs";
import { getDb, agents, messages } from "@dialog/db";
import { and, eq, like } from "drizzle-orm";
import { completedRequests, requestDetail, parseSummaryCard, isConfirmationCard, withoutControls, labelFor } from "../lib/completedRequests";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${got === undefined ? "" : `\n         ${JSON.stringify(got).slice(0, 400)}`}`); }
};

const B = "```";

console.log("\nReading the card the customer was shown");
{
  const msg = `Payment received — thank you.

${B}summary
title: APPLICATION CONFIRMED — YI FANG TAIWAN FRUIT TEA L.L.C
- Application reference: LR-37380
- Payment: AED 1,000 — paid
total: AED 1,000.00
${B}

${B}buttons
- Check application status
${B}`;
  const card = parseSummaryCard(msg);
  check("the title", card?.title === "APPLICATION CONFIRMED — YI FANG TAIWAN FRUIT TEA L.L.C", card);
  check("the rows, in order", card?.rows[0]?.label === "Application reference" && card?.rows[0]?.value === "LR-37380", card?.rows);
  check("a value that contains an em dash is not split", card?.rows[1]?.value === "AED 1,000 — paid", card?.rows);
  check("the total footer", card?.total === "AED 1,000.00", card);
  check("a message with no card reads as none", parseSummaryCard("Thanks, all done.") === null);
  check("the controls come off the closing message", !withoutControls(msg).includes("Check application status"), withoutControls(msg));
  check("...and the prose stays", withoutControls(msg).startsWith("Payment received"));
  check("a key with no label of its own gets a readable one", labelFor("trade_license_number") === "Trade license number");

  // THE CONVERSATION DOES NOT STOP AT THE CONFIRMATION. A renewal confirmed as
  // "Renewal Confirmed — Reference PER-9016" was followed by the customer asking
  // where the branch is, and the LAST summary card in that transcript is the
  // branch's opening hours. Taking the newest card would have put that under the
  // heading "Confirmed summary".
  const branchCard = parseSummaryCard(`${B}summary\ntitle: Al Rashidiyah Post Office\n- Emirate: Dubai\n- Working hours: 08:00 AM - 06:30 PM\n${B}`)!;
  const renewalCard = parseSummaryCard(`${B}summary\ntitle: Renewal Confirmed\n- Reference: PER-9016\n- PO Box: 5200, Ajman\ntotal: AED 995.00\n${B}`)!;
  const reviewCard = parseSummaryCard(`${B}summary\ntitle: Renewal Summary\n- PO Box: 5200, Ajman\n- Bundle: MyHome Instant\ntotal: AED 995.00\n${B}`)!;
  check("a branch card is not a confirmation", !isConfirmationCard(branchCard, "PER-9016"));
  check("a confirmation is", isConfirmationCard(renewalCard, "PER-9016"));
  check("a pre-payment review card is not", !isConfirmationCard(reviewCard, "PER-9016"));
  check("EPGL's wording counts too", isConfirmationCard(parseSummaryCard(`${B}summary\ntitle: APPLICATION CONFIRMED — YI FANG\n- Postal activity: Letters\n${B}`)!, null));
}

console.log("\nAgainst the database");
const db = getDb();
const all = await db.select({ id: agents.id, slug: agents.slug, name: agents.name }).from(agents);
check("there are agents to list requests for", all.length > 0, all.length);

let checkedDetail = false;
for (const a of all) {
  const rows = await completedRequests(a.id, 500);
  console.log(`  ·    ${a.slug}: ${rows.length} completed`);
  if (!rows.length) continue;

  check(`${a.slug}: every row has something to identify it by`, rows.every((r) => r.reference || r.paymentStatus === "paid"), rows.find((r) => !r.reference && r.paymentStatus !== "paid"));
  check(`${a.slug}: newest first`, rows.every((r, i2) => i2 === 0 || rows[i2 - 1]!.completedAt >= r.completedAt));
  check(`${a.slug}: an amount is a number or nothing, never a string`, rows.every((r) => r.amount === null || typeof r.amount === "number"));
  check(`${a.slug}: the outbound write is reported either way`, rows.every((r) => ["ok", "failed", "none"].includes(r.sentToRecord)));

    // A request with a reference always has SOMETHING to read: when the journey
    // confirmed without a summary card — EPGL's Virtual IBAN branch sets the
    // details out in bold — the closing message falls back to the message that
    // first said the reference, which is the moment it was issued.
    const referenced = rows.filter((r) => r.reference).slice(0, 5);
    for (const r of referenced) {
      const d = await requestDetail(a.id, r.caseId);
      check(`${a.slug}/${r.reference}: the panel has a closing message to show`, Boolean(d?.confirmationText || d?.confirmation), d?.confirmationKind);
      // No confirmation card in the transcript — EPGL's Virtual IBAN branch sets
      // the details out in bold instead — so the message shown is the one that
      // first said the reference, which is the moment it was issued.
      if (d && d.confirmationKind === "latest" && d.confirmationText) {
        // Only where the assistant ever wrote the reference out. Emirates Post's
        // own reference is a long number the confirmation does not always quote.
        const [spoken] = await db
          .select({ c: messages.content })
          .from(messages)
          .where(and(eq(messages.conversationId, r.conversationId), eq(messages.role, "assistant"), like(messages.content, `%${r.reference}%`)))
          .limit(1);
        if (spoken) {
          check(`${a.slug}/${r.reference}: ...naming the reference`, d.confirmationText.includes(r.reference!), d.confirmationText.slice(0, 160));
        }
      }
    }

  // A submitted-but-unpaid request must be in the list: on EPGL that is the whole
  // Virtual IBAN branch, which settles days later at the bank.
  const unpaid = rows.filter((r) => r.paymentStatus !== "paid");
  const paid = rows.filter((r) => r.paymentStatus === "paid");
  console.log(`  ·    ${a.slug}: ${paid.length} paid, ${unpaid.length} submitted without a settled payment`);

  if (!checkedDetail) {
    const withCard = await (async () => {
      for (const r of rows.slice(0, 12)) {
        const d = await requestDetail(a.id, r.caseId);
        if (d?.confirmation && d.confirmationKind === "confirmation") return d;
      }
      return null;
    })();
    const d = withCard ?? (await requestDetail(a.id, rows[0]!.caseId));
    check(`${a.slug}: the detail loads`, Boolean(d), d);
    if (d) {
      checkedDetail = true;
      check("the list row and the detail agree", d.caseId === d.caseId && d.reference === (withCard ?? rows[0])!.reference);
      check("the collected fields are readable", d.fields.every((f) => f.label && f.value));
      check("no internal keys leak into the panel", d.fields.every((f) => !f.key.startsWith("__")), d.fields.map((f) => f.key));
      check("the calls carry what was sent", d.calls.every((c) => "request" in c && typeof c.ok === "boolean"));
      if (withCard) {
        check("the confirmation came from the transcript", (withCard.confirmation?.rows.length ?? 0) > 0, withCard.confirmation);
        check("...and the panel is told which card it is holding", ["confirmation", "latest"].includes(withCard.confirmationKind), withCard.confirmationKind);
        // The card is rendered on its own, so the message printed beside it has
        // the card taken out — otherwise the panel shows the same eight rows
        // twice, once as a table and once as markdown.
        check("the closing message does not repeat the card", !/```/.test(withCard.confirmationText ?? ""), withCard.confirmationText?.slice(0, 160));
        check("...and there is still a message to read", Boolean((withCard.confirmationText ?? "").trim()), withCard.confirmationText);
        console.log(`  ·    sample card: ${withCard.confirmation?.title ?? "(no title)"} — ${withCard.confirmation?.rows.length} rows`);
      } else {
        console.log("  ·    no summary card in the sampled conversations — card parsing covered by the unit checks above");
      }
      console.log(`  ·    sample detail: ${d.fields.length} fields, ${d.docs.length} documents, ${d.calls.length} calls, ${d.emails.length} email rows`);
    }
  }
}

console.log("\nWired into the admin panel");
{
  const editor = readFileSync(new URL("../app/admin/[slug]/Editor.tsx", import.meta.url), "utf8");
  check("the tab exists for every agent", /"Integrations", "Requests", "Blocklist"/.test(editor));
  check("...and renders the manager", /tab === "Requests" &&/.test(editor));
  const route = readFileSync(new URL("../app/api/admin/agents/[slug]/requests/route.ts", import.meta.url), "utf8");
  check("the endpoint is scoped to the caller's agents", /const denied = await denyAgent\(slug\);/.test(route));
  check("...serves one request in full", /requestDetail\(agent\.id, caseId\)/.test(route));
  check("...and exports the list as CSV", /format"\) === "csv"/.test(route));
  check("the CSV opens in Excel with Arabic names intact", /\\ufeff|﻿/.test(route));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
