import Link from "next/link";
import { loadDashboards, listAgentsForFilter } from "@/lib/metrics";
import { AgentFilter } from "../AgentFilter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90];

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "warn" }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-surface p-4 shadow-[var(--shadow-xs)]">
      <div className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-[26px] font-bold tracking-tight ${tone === "pos" ? "text-[#079455]" : tone === "warn" ? "text-[#b54708]" : "text-ink"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

function Bars({ data, color = "var(--color-brand)" }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="py-6 text-center text-[13px] text-muted">No data in this window.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-[13px] text-ink-2" title={d.label}>{d.label}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
            <span className="block h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </span>
          <span className="w-10 shrink-0 text-right text-[13px] font-semibold tabular-nums">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-line)] bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
      <p className="mb-4 mt-0.5 text-[12.5px] text-muted">{desc}</p>
      {children}
    </section>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string; agent?: string }> }) {
  const { days, agent } = await searchParams;
  const windowDays = RANGES.includes(Number(days)) ? Number(days) : 30;
  const agentList = await listAgentsForFilter();
  const selected = agent ? agentList.find((a) => a.slug === agent) : undefined;
  const d = await loadDashboards(windowDays, selected?.id);
  const k = d.kpis;
  // Preserve the agent scope on the range links.
  const rangeHref = (r: number) => `/admin/analytics?days=${r}${selected ? `&agent=${selected.slug}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Analytics &amp; Monitoring</h1>
          <p className="mt-1 text-[14px] text-muted">
            KPIs, conversation, journey, escalation, SLA and operational dashboards · {selected ? selected.name : "all agents"} · last {windowDays} days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AgentFilter agents={agentList} />
          <div className="flex gap-1 rounded-lg border border-[var(--color-line)] bg-surface p-0.5">
            {RANGES.map((r) => (
              <Link key={r} href={rangeHref(r)} className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${r === windowDays ? "bg-[var(--color-line-soft)] text-ink" : "text-muted hover:text-ink"}`}>{r}d</Link>
            ))}
          </div>
        </div>
      </div>

      {/* 1 — KPI Dashboard */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Conversations" value={String(k.conversations)} sub={`${k.intentsClassified} intents classified`} />
        <Stat label="Journey completion" value={`${k.journeyCompletionRate}%`} sub={`${k.journeysCompleted}/${k.journeysStarted} completed`} tone={k.journeyCompletionRate >= 60 ? "pos" : undefined} />
        <Stat label="Payment success" value={`${k.paymentSuccessRate}%`} sub={`${d.payments.completed}/${d.payments.initiated} paid`} tone={k.paymentSuccessRate >= 95 ? "pos" : undefined} />
        <Stat label="Self-service rate" value={`${k.selfServiceRate}%`} sub={`${d.escalations.total} callbacks`} tone={k.selfServiceRate >= 70 ? "pos" : undefined} />
        <Stat label="Abandonment" value={`${k.abandonmentRate}%`} sub="of started journeys" tone={k.abandonmentRate > 20 ? "warn" : undefined} />
        <Stat label="Knowledge hits" value={String(k.knowledgeRetrievals)} sub="grounded answers" />
        <Stat label="Shipment lookups" value={String(k.shipmentLookups)} sub="tracking requests" />
        <Stat label="SLA breaches" value={String(d.sla.total)} sub={`${d.sla.payment} payment · ${d.sla.callback} callback`} tone={d.sla.total > 0 ? "warn" : "pos"} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 2 — Conversation analytics */}
        <Panel title="Conversation analytics" desc="Why customers contact us — intent distribution, language & customer type.">
          <Bars data={d.intents.map((i) => ({ label: i.intent, value: i.count }))} />
          <div className="mt-4 flex flex-wrap gap-4 border-t border-[var(--color-line-soft)] pt-3 text-[12.5px] text-muted">
            <span>Languages: {d.languages.map((l) => `${l.language.toUpperCase()} ${l.count}`).join(" · ") || "—"}</span>
            <span>· Customers: {d.customerTypes.map((cst) => `${cst.type} ${cst.count}`).join(" · ") || "—"}</span>
          </div>
        </Panel>

        {/* 3 — Journey performance */}
        <Panel title="Journey performance" desc="Starts, completions and abandonment per journey.">
          {d.journeys.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">No journeys started in this window.</p> : (
            <div className="flex flex-col gap-3">
              {d.journeys.map((j) => (
                <div key={j.journey} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate font-mono text-[12.5px] text-ink-2" title={j.journey}>{j.journey}</span>
                  <span className="flex-1 text-[12.5px] text-muted">{j.started} started · {j.completed} done · {j.abandoned} left</span>
                  <span className={`w-12 text-right text-[13px] font-semibold ${j.rate >= 60 ? "text-[#079455]" : ""}`}>{j.rate}%</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* 4 — Escalation monitoring */}
        <Panel title="Escalation monitoring" desc="Human callbacks generated and escalation rate.">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Callbacks" value={String(d.escalations.total)} />
            <Stat label="Escalation rate" value={`${d.escalations.rate}%`} sub="of conversations" tone={d.escalations.rate <= 15 ? "pos" : "warn"} />
          </div>
        </Panel>

        {/* 5 — SLA monitoring */}
        <Panel title="SLA monitoring" desc="Breaches detected by the reconciliation sweep (payments stuck, callbacks overdue).">
          <Bars color="#f79009" data={[{ label: "Payment stuck", value: d.sla.payment }, { label: "Callback overdue", value: d.sla.callback }]} />
        </Panel>

        {/* 6 — Operational monitoring */}
        <Panel title="Operational monitoring" desc="Event volume over time and payment pipeline health.">
          <Bars data={d.volume.slice(-14).map((v) => ({ label: v.day, value: v.count }))} />
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--color-line-soft)] pt-3">
            <Stat label="Pay initiated" value={String(d.payments.initiated)} />
            <Stat label="Pay completed" value={String(d.payments.completed)} tone="pos" />
            <Stat label="Pay failed" value={String(d.payments.failed)} tone={d.payments.failed > 0 ? "warn" : undefined} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
