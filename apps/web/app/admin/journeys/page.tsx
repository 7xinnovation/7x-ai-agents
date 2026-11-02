/**
 * WHICH thirty-nine? (2 November 2026)
 *
 * Emirates Post, on the dashboard: "Currently it says 39 journeys completed
 * with no information about any of them." The count has been on the overview
 * since the beginning and the rows behind it have never been shown anywhere, so
 * the only thing anyone could do with the number was believe it.
 *
 * Every column here already existed on the event. Nothing new is recorded.
 */
import Link from "next/link";
import { completedJourneys, type Window } from "@/lib/transactions";
import { listAgentsForFilter } from "@/lib/metrics";
import { AgentFilter } from "../AgentFilter";
import { currentScope, selectAgent } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGES: { value: Window; label: string }[] = [
  { value: "all", label: "All time" },
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
];

const pretty = (s: string) => s.replace(/[_.]/g, " ").replace(/^./, (c) => c.toUpperCase());
const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "Asia/Dubai",
  });
const money = (n: number, ccy: string) =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function JourneysPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; agent?: string }>;
}) {
  const { days, agent } = await searchParams;
  const windowDays: Window = RANGES.some((r) => r.value !== "all" && String(r.value) === days) ? Number(days) : "all";
  const agentList = await listAgentsForFilter();
  const scope = await currentScope();
  const selected = selectAgent(agentList, agent, scope);
  const rows = await completedJourneys({ windowDays, agentId: selected?.id, limit: 300 });

  const href = (r: Window) => `/admin/journeys?days=${r}${selected ? `&agent=${selected.slug}` : ""}`;
  const paidCount = rows.filter((r) => r.payment?.status === "paid").length;

  return (
    <>
      <header className="sa-top">
        <div>
          <h1>Journeys completed</h1>
          <p>
            Every journey that reached a confirmed outcome
            {selected ? ` · ${selected.name}` : " across all agents"}.
          </p>
        </div>
        <AgentFilter agents={agentList} allowAll={!scope} />
      </header>

      <div className="sa-tabs">
        {RANGES.map((r) => (
          <Link key={String(r.value)} href={href(r.value)} className={`sa-tab ${r.value === windowDays ? "on" : ""}`}>
            {r.label}
          </Link>
        ))}
      </div>

      <div className="sa-stats sa-stats-3">
        <div className="sa-stat">
          <span className="sa-stat-label">Completed</span>
          <span className="sa-stat-value">{rows.length.toLocaleString("en-US")}</span>
          <span className="sa-stat-hint">{windowDays === "all" ? "in all" : `in the last ${windowDays} days`}</span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">With a settled payment</span>
          <span className="sa-stat-value">{paidCount.toLocaleString("en-US")}</span>
          <span className="sa-stat-hint">not every journey takes money</span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Carrying a reference</span>
          <span className="sa-stat-value">{rows.filter((r) => r.reference).length.toLocaleString("en-US")}</span>
          <span className="sa-stat-hint">the number the customer was given</span>
        </div>
      </div>

      <section className="sa-panel">
        <div className="sa-panel-head">
          <h2>Completions</h2>
          <span className="sa-muted">newest first{rows.length >= 300 ? " · showing the latest 300" : ""}</span>
        </div>

        {rows.length === 0 ? (
          <p className="sa-empty-line">Nothing completed in this window.</p>
        ) : (
          <div className="sa-table sa-txn">
            <div className="sa-tr sa-th">
              <span>Completed</span>
              <span>Agent</span>
              <span>Journey</span>
              <span>Reference</span>
              <span>Customer</span>
              <span>Payment</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div className="sa-tr" key={`${r.conversationId ?? "x"}-${i}`}>
                <span className="sa-nowrap">{when(r.completedAt)}</span>
                <span>{r.agentName ?? "—"}</span>
                <span>{r.journey ? pretty(r.journey) : "—"}</span>
                <span className="sa-mono">{r.reference ?? "—"}</span>
                <span>
                  {r.customerType ?? "—"}
                  {r.language ? ` · ${r.language.toUpperCase()}` : ""}
                </span>
                <span>
                  {r.payment ? (
                    <>
                      {money(r.payment.amount, r.payment.currency)}
                      <span className={`sa-tag ${r.payment.status === "paid" ? "ok" : r.payment.status === "failed" ? "bad" : ""}`}>
                        {r.payment.status}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="sa-cell-actions">
                  {r.conversationId ? <Link href={`/admin/conversations/${r.conversationId}`}>Transcript</Link> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
