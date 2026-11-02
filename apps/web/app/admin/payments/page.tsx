/**
 * Every transaction, not just the total (2 November 2026).
 *
 * The other half of the same request: "payment received (all details about the
 * transactions)". The dashboard has carried a settled figure and a four-way
 * split — raised, settled, declined, stuck — with no way to see a single row
 * behind any of them.
 *
 * Declined and still-open payments are listed beside the settled ones on
 * purpose. A page that showed only what arrived would answer "how much did we
 * take" and hide the question anyone actually opens this for, which is why a
 * particular customer's payment is not on it.
 */
import Link from "next/link";
import { paymentRows, paymentTotals, type Window } from "@/lib/transactions";
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
const STATUSES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "paid", label: "Settled" },
  { value: "failed", label: "Declined" },
  { value: "initiated", label: "Open" },
];

const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "Asia/Dubai",
  });
const money = (n: number, ccy = "AED") =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; agent?: string; status?: string }>;
}) {
  const { days, agent, status } = await searchParams;
  const windowDays: Window = RANGES.some((r) => r.value !== "all" && String(r.value) === days) ? Number(days) : "all";
  const picked = STATUSES.some((s) => s.value && s.value === status) ? status! : "";
  const agentList = await listAgentsForFilter();
  const scope = await currentScope();
  const selected = selectAgent(agentList, agent, scope);
  const rows = await paymentRows({ windowDays, agentId: selected?.id, status: picked || null, limit: 300 });
  const t = paymentTotals(rows);

  const qs = (over: { days?: Window; status?: string }) => {
    const p = new URLSearchParams();
    p.set("days", String(over.days ?? windowDays));
    const s = over.status ?? picked;
    if (s) p.set("status", s);
    if (selected) p.set("agent", selected.slug);
    return `/admin/payments?${p.toString()}`;
  };

  return (
    <>
      <header className="sa-top">
        <div>
          <h1>Payments</h1>
          <p>
            Every payment raised, settled or not
            {selected ? ` · ${selected.name}` : " across all agents"}.
          </p>
        </div>
        <AgentFilter agents={agentList} allowAll={!scope} />
      </header>

      <div className="sa-tabs">
        {RANGES.map((r) => (
          <Link key={String(r.value)} href={qs({ days: r.value })} className={`sa-tab ${r.value === windowDays ? "on" : ""}`}>
            {r.label}
          </Link>
        ))}
      </div>

      <div className="sa-stats sa-stats-3">
        <div className="sa-stat">
          <span className="sa-stat-label">Settled</span>
          <span className="sa-stat-value">{money(t.settledAmount)}</span>
          <span className="sa-stat-hint">
            {t.settled.toLocaleString("en-US")} of {t.count.toLocaleString("en-US")} raised
          </span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Declined</span>
          <span className="sa-stat-value" style={{ color: t.declined ? "var(--danger, #d92d20)" : undefined }}>
            {t.declined.toLocaleString("en-US")}
          </span>
          <span className="sa-stat-hint">the gateway refused them</span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Still open</span>
          <span className="sa-stat-value">{t.open.toLocaleString("en-US")}</span>
          <span className="sa-stat-hint">raised, never confirmed either way</span>
        </div>
      </div>

      <section className="sa-panel">
        <div className="sa-panel-head">
          <h2>Transactions</h2>
          <div className="sa-tabs" style={{ marginBottom: 0, borderBottom: "none" }}>
            {STATUSES.map((s) => (
              <Link key={s.label} href={qs({ status: s.value })} className={`sa-tab ${s.value === picked ? "on" : ""}`}>
                {s.label}
              </Link>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="sa-empty-line">No payments in this window.</p>
        ) : (
          <div className="sa-table sa-txn">
            <div className="sa-tr sa-th">
              <span>Raised</span>
              <span>Agent</span>
              <span>Reference</span>
              <span>Amount</span>
              <span>Status</span>
              <span>Gateway</span>
              <span />
            </div>
            {rows.map((r) => (
              <div className="sa-tr" key={r.id}>
                <span className="sa-nowrap">{when(r.createdAt)}</span>
                <span>{r.agentName ?? "—"}</span>
                <span className="sa-mono">{r.reference}</span>
                <span>{money(r.amount, r.currency)}</span>
                <span>
                  <span className={`sa-tag ${r.status === "paid" ? "ok" : r.status === "failed" ? "bad" : ""}`}>{r.status}</span>
                </span>
                <span className="sa-mono">
                  {r.provider ?? "default"}
                  {r.gatewayRef ? <span className="sa-muted"> · {r.gatewayRef}</span> : null}
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
