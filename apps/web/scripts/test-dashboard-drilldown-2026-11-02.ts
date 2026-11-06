/**
 * "39 journeys completed with no information about any of them" (2 Nov 2026).
 *
 * Emirates Post asked for a route from the two numbers on the dashboard to the
 * rows behind them — the journeys, and the transactions. Nothing new is
 * recorded to do it: `journey.completed` has carried the conversation, the
 * journey and the reference since the taxonomy was written, and `payments` has
 * always held the rest. It had simply never been read back.
 *
 * What is worth pinning is the arithmetic (money that did not arrive is not
 * revenue) and the wiring (a stat that opens a list must open the SAME slice it
 * counted, or the list contradicts the number that led to it).
 *
 * Run from apps/web:  npx tsx scripts/test-dashboard-drilldown-2026-11-02.ts
 */
import { readFileSync } from "node:fs";
import { paymentRank, paymentTotals, windowStart, type PaymentRow } from "../lib/transactions";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : (extra ?? ""));
  ok ? pass++ : fail++;
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// ---- the window ------------------------------------------------------------
check("all time has no cut-off", windowStart("all") === null);
{
  const d = windowStart(30)!;
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  check("30 days is thirty days ago", days === 30, days);
}

// ---- what counts as money ---------------------------------------------------
const row = (status: string, amount: number): PaymentRow => ({
  id: `${status}-${amount}`, conversationId: null, agentName: null, agentSlug: null,
  reference: "R", amount, currency: "AED", status, provider: null, gatewayRef: null,
  createdAt: new Date(), updatedAt: new Date(),
});
{
  const t = paymentTotals([row("paid", 370), row("paid", 1290.25), row("failed", 999), row("initiated", 500)]);
  check("every payment raised is counted", t.count === 4, t);
  check("settled, declined and open are counted apart", t.settled === 2 && t.declined === 1 && t.open === 1, t);
  /**
   * A payment that was raised and never confirmed is not revenue, and a
   * declined one certainly is not. The dashboard's headline figure has always
   * meant settled money and the list has to agree with it.
   */
  check("only settled money is money", t.settledAmount === 1660.25, t.settledAmount);
  check("...so a decline adds nothing", paymentTotals([row("failed", 999)]).settledAmount === 0);
  check("...and nor does one still open", paymentTotals([row("initiated", 500)]).settledAmount === 0);
}
check("an empty window totals to zero, not NaN", paymentTotals([]).settledAmount === 0);
/** 1,290.25 became 1,290 once before, in the payments column itself. */
check("the fils survive", paymentTotals([row("paid", 1290.25)]).settledAmount === 1290.25);

// ---- which payment describes a completed journey ---------------------------
/**
 * Found by seeding a conversation with a decline and a settlement a second
 * apart: ordering by time alone showed whichever came last, so a journey that
 * was paid for read "declined". Settled wins.
 */
check("a settlement outranks a decline", paymentRank("paid") > paymentRank("failed"));
check("...and an open payment too", paymentRank("paid") > paymentRank("initiated"));
check("an open payment still beats a decline — it may yet land", paymentRank("initiated") > paymentRank("failed"));
check("an unknown status ranks lowest, never above a settlement", paymentRank("whatever") < paymentRank("paid"));

// ---- the pages exist and are reachable --------------------------------------
const journeys = read("../app/admin/journeys/page.tsx");
const paymentsPage = read("../app/admin/payments/page.tsx");
const charts = read("../app/admin/analytics/Charts.tsx");
const insights = read("../app/admin/analytics/page.tsx");
const nav = read("../app/admin/layout.tsx");

check("there is a journeys page", journeys.includes("completedJourneys"));
check("there is a payments page", paymentsPage.includes("paymentRows"));
check("both are in the sidebar", nav.includes('href: "/admin/journeys"') && nav.includes('href: "/admin/payments"'));

// ---- a stat that opens a list says so, and opens the right one --------------
check("a stat can carry a link", /href\?: string;/.test(charts));
check("...and renders as one when it does", /href \? \(\s*<Link href=\{href\}/.test(charts));
check("...and stays a plain card when it does not", /<div className=\{box\}>\{card\}<\/div>/.test(charts));
check("the arrow is a real character, not an escape", charts.includes("→") && !charts.includes("\\u2192"));

check("journeys completed opens the journeys list", /label="Journeys completed"[^\n]*href=\{drill\("\/admin\/journeys"\)\}/.test(insights));
check("revenue opens the settled payments", /label="Revenue collected \(AED\)"[^\n]*status: "paid"/.test(insights));
for (const [label, status] of [["Settled", "paid"], ["Declined", "failed"], ["Stuck", "initiated"]] as [string, string][])
  check(`${label} opens the ${status} payments`, new RegExp(`label="${label}"[^\\n]*status: "${status}"`).test(insights));
check("Raised opens them all", /label="Raised"[^\n]*href=\{drill\("\/admin\/payments"\)\}/.test(insights));

/**
 * The slice has to travel. A stat counted within a window, for one agent, that
 * opens an all-time list across every agent is a list that disagrees with the
 * number that was clicked.
 */
check("the window travels with the link", /p = new URLSearchParams\(\{ days: String\(windowDays\) \}\)/.test(insights));
check("...and so does the agent", /if \(selected\) p\.set\("agent", selected\.slug\)/.test(insights));

// ---- the lists are scoped the same way every other admin page is ------------
for (const [name, src] of [["journeys", journeys], ["payments", paymentsPage]] as [string, string][]) {
  check(`${name} honours the account's agent scope`, src.includes("currentScope") && src.includes("selectAgent"));
  check(`${name} offers the agent filter`, src.includes("<AgentFilter"));
  // Payments rows open the transaction page (6 November), which carries the transcript.
  check(`${name} links each row to its transcript`, src.includes("/admin/conversations/") || (name === "payments" && src.includes("/admin/payments/${r.id}")));
  check(`${name} says plainly when there is nothing`, /sa-empty-line/.test(src));
  check(`${name} is never cached`, src.includes('export const dynamic = "force-dynamic"'));
}
check("a journey with no payment is not shown as free", journeys.includes('r.payment ? ('));
check("...and the declined ones are visible, not filtered away", paymentsPage.includes('{ value: "failed", label: "Declined" }'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
