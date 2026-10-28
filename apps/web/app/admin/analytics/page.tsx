import Link from "next/link";
import { loadInsights, listAgentsForFilter, type Window } from "@/lib/insights";
import { AgentFilter } from "../AgentFilter";
import { currentScope, selectAgent } from "@/lib/scope";
import { BarList, Empty, Footnote, Funnel, Legend, Panel, SectionHeading, StackedDays, Stat, Table, seriesColor } from "./Charts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ALL TIME IS THE DEFAULT.
 *
 * A 30-day default answers "how was last month", which nobody opened this page
 * to ask. These services run at a few dozen journeys a month, so a month-wide
 * window puts most of the history off-screen and makes every trend look like a
 * collapse. The whole record is the useful default; the shorter windows are
 * there for when somebody wants to narrow to one.
 */
const RANGES: { value: Window; label: string }[] = [
  { value: "all", label: "All time" },
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
];

const pretty = (s: string) => s.replace(/[_.]/g, " ").replace(/^./, (c) => c.toUpperCase());
const aed = (v: number) => `AED ${v.toLocaleString("en-US")}`;

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ days?: string; agent?: string }> }) {
  const { days, agent } = await searchParams;
  const windowDays: Window = RANGES.some((r) => r.value !== "all" && String(r.value) === days) ? Number(days) : "all";
  const agentList = await listAgentsForFilter();
  const scope = await currentScope();
  const selected = selectAgent(agentList, agent, scope);
  const d = await loadInsights(windowDays, selected?.id);

  // Preserve the agent scope on the range links.
  const rangeHref = (r: Window) => `/admin/analytics?days=${r}${selected ? `&agent=${selected.slug}` : ""}`;
  const selectedRange: Window = windowDays;
  // "the last 30 days" is wrong for a window that means everything.
  const period = d.allTime ? "across everything on record" : `in the last ${d.windowDays} days`;
  const label = (k: string) => d.journeyLabel[k] ?? pretty(k);
  const legend = d.journeyKeys.map((k, i) => ({ label: label(k), color: seriesColor(i) }));

  const h = d.headline;
  const outOfScope = d.intents.filter((i) => i.scope !== "in");
  const servedTotal = d.languages.reduce((s, l) => s + l.count, 0);
  const arabic = d.languages.find((l) => l.language === "AR")?.count ?? 0;
  const arabicShare = servedTotal ? Math.round((arabic / servedTotal) * 1000) / 10 : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* ---------------------------------------------------------- header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{selected ? selected.name : "All agents"} — insights</h1>
          <p className="mt-1 max-w-[70ch] text-[14px] text-muted">
            {h.completed.now > 0
              ? `${h.completed.now.toLocaleString("en-US")} journeys completed and ${aed(h.revenueAed.now)} collected ${period}; ${h.completionRate.now}% of started journeys reached a confirmed outcome.`
              : `Nothing has completed ${period}. ${h.conversations.now.toLocaleString("en-US")} conversations were opened.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AgentFilter agents={agentList} allowAll={!scope} />
          <div className="flex gap-1 rounded-lg border border-[var(--color-line)] bg-surface p-0.5">
            {RANGES.map((r) => (
              <Link
                key={String(r.value)}
                href={rangeHref(r.value)}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${r.value === selectedRange ? "bg-[var(--color-line-soft)] text-ink" : "text-muted hover:text-ink"}`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------ what customers got done */}
      <SectionHeading
        title="What customers got done"
        note={d.allTime ? `Everything on record — ${d.windowDays} days, with nothing before it to compare against` : `Last ${d.windowDays} days vs the ${d.windowDays} before`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Journeys completed" value={h.completed.now} delta={h.completed.pct} />
        <Stat label="Revenue collected (AED)" value={h.revenueAed.now} delta={h.revenueAed.pct} />
        <Stat label="Outcome completion" value={`${h.completionRate.now}%`} delta={h.completionRate.pct} deltaUnit=" pts" />
        <Stat label="Conversations" value={h.conversations.now} delta={h.conversations.pct} />
      </div>
      <Footnote>
        Outcome completion: journeys that reached a confirmed outcome, as a share of journeys started. Revenue counts payments this
        platform recorded as settled — a journey paid on a backend gateway we never see is not in it.
      </Footnote>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={d.grain === "week" ? "Completions per week" : "Completions per day"} desc="Confirmed outcomes, stacked by journey.">
          <StackedDays days={d.daily} keys={d.journeyKeys} label={label} />
          <Legend items={legend} />
        </Panel>

        <Panel title="By journey" desc="Completed this period, against the number that started it.">
          <BarList
            data={d.journeys.map((j, i) => ({
              label: label(j.key),
              value: j.completed,
              of: j.started,
              color: seriesColor(d.journeyKeys.indexOf(j.key) === -1 ? i : d.journeyKeys.indexOf(j.key)),
            }))}
          />
        </Panel>
      </div>

      {/* -------------------------------------------------------- what they chose */}
      {d.facets.length > 0 && (
        <>
          <SectionHeading title="What customers chose" note="Answers given during the journey, by field" />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {d.facets.slice(0, 3).map((f) => (
              <Panel key={f.key} title={f.label}>
                <BarList data={f.rows.map((r) => ({ label: r.value, value: r.count }))} labelWidth="w-28" />
              </Panel>
            ))}
          </div>
        </>
      )}

      {/* -------------------------------------------------------------- funnel */}
      <SectionHeading title="Where customers drop off" note="Conversation to confirmed outcome" />
      <Panel
        title="Journey funnel"
        desc={
          d.allTime
            ? "The share lost at each step is on the right; the largest loss is red."
            : "Thick bar this period, thin bar the period before. The share lost at each step is on the right; the largest loss is red."
        }
      >
        <Funnel steps={d.funnel} />
        <Footnote>
          Every rung counts conversations, distinctly. Payment is deliberately not a rung: the journeys disagree about when money changes
          hands — a new licence files first and pays after, a PO Box pays before it is confirmed — so it has its own pipeline below. Where
          a rung is wider than the one above, the loss reads “—” rather than a false gain.
        </Footnote>
      </Panel>

      {/* -------------------------------------------------- journey performance */}
      <SectionHeading title="Journey performance" />
      <Panel title="Per journey" desc="Starts, completions, abandonment, how long a finished one took, and where the unfinished ones stopped.">
        <Table
          head={["Journey", "Started", "Completed", "Rate", "Abandoned", "Median min", "Top drop step"]}
          rows={d.journeys.map((j) => [
            <span key="j" className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: seriesColor(Math.max(0, d.journeyKeys.indexOf(j.key))) }} />
              {label(j.key)}
            </span>,
            j.started,
            j.completed,
            <span key="r" style={{ color: j.rate >= 60 ? "#079455" : j.rate < 30 ? "#b54708" : undefined }}>
              {j.rate}%
            </span>,
            j.abandoned,
            j.medianMinutes ?? "—",
            <span key="s" className="font-normal text-muted">
              {j.topDropStep ? pretty(j.topDropStep) : "—"}
            </span>,
          ])}
        />
      </Panel>

      {/* ------------------------------------------------------- payment health */}
      <SectionHeading title="Payment health" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Payment pipeline" desc="Every payment raised ends settled, declined, or stuck.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Raised" value={d.payments.initiated} />
            <Stat label="Settled" value={d.payments.paid} tone="pos" />
            <Stat label="Declined" value={d.payments.failed} tone={d.payments.failed ? "crit" : undefined} />
            <Stat label="Stuck" value={d.payments.abandoned} tone={d.payments.abandoned ? "warn" : undefined} />
          </div>
          <div className="mt-4 border-t border-[var(--color-line-soft)] pt-3">
            <Footnote>
              Stuck means raised, with nothing back from the gateway — a different problem from a decline, because the customer may well
              have been charged. The reconciliation sweep resolves these and the SLA section counts the ones it could not.
            </Footnote>
          </div>
        </Panel>

        <Panel title="By gateway" desc="Which gateway took the money, and how often it settled.">
          <Table
            head={["Gateway", "Attempts", "Settled", "Rate"]}
            rows={d.payments.byProvider.map((p) => [
              pretty(p.provider),
              p.attempts,
              p.paid,
              <span key="r" style={{ color: p.rate >= 95 ? "#079455" : p.rate < 80 ? "#b54708" : undefined }}>
                {p.rate}%
              </span>,
            ])}
          />
          <div className="mt-3">
            <Footnote>{aed(d.payments.revenueAed)} settled {d.allTime ? "in all" : "in this window"}.</Footnote>
          </div>
        </Panel>
      </div>

      {/* ------------------------------------------------------ demand & intent */}
      <SectionHeading title="Demand and intent" note="What people came for, including what we do not do" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="What customers asked for" desc="Every recognised intent, and whether a journey exists to serve it.">
          <BarList
            data={d.intents.map((i) => ({
              label: pretty(i.intent),
              value: i.count,
              color: i.scope === "in" ? "#0020f5" : i.scope === "out" ? "#98a2b3" : "#d92d20",
            }))}
          />
          <Legend
            items={[
              { label: "A journey serves it", color: "#0020f5" },
              { label: "No journey — answered or deflected", color: "#98a2b3" },
              { label: "Not recognised", color: "#d92d20" },
            ]}
          />
        </Panel>

        <Panel
          title="Demand with no journey behind it"
          desc="Each line needs an owner — answer it from the knowledge base, deflect it, build the journey, or tune the intent model."
        >
          <Table
            head={["Intent", "Count", "What it is"]}
            rows={outOfScope.map((i) => [
              pretty(i.intent),
              i.count,
              <span key="s" className="font-normal text-muted">
                {i.scope === "unknown" ? "not recognised" : "no journey"}
              </span>,
            ])}
          />
          <div className="mt-4 border-t border-[var(--color-line-soft)] pt-3">
            <Stat
              label="Not-recognised rate"
              value={`${d.unknownRate.now}%`}
              delta={d.unknownRate.pct}
              deltaUnit=" pts"
              upIsGood={false}
              tone={d.unknownRate.now > 15 ? "warn" : undefined}
            />
          </div>
        </Panel>
      </div>

      {/* ------------------------------------------- service quality & handoff */}
      <SectionHeading title="Service quality and human handoff" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Escalations by reason" desc="Why a conversation needed a person.">
          <BarList data={d.escalations.byReason.map((r) => ({ label: pretty(r.reason), value: r.count }))} />
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--color-line-soft)] pt-3">
            <Stat label="Callbacks raised" value={d.escalations.total} />
            <Stat label="Escalation rate" value={`${d.escalations.rate}%`} sub="of conversations" tone={d.escalations.rate <= 15 ? "pos" : "warn"} />
          </div>
        </Panel>

        <Panel title="Data quality in the journey" desc="How often the documents and the backends behaved.">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Documents accepted" value={d.quality.documentsUploaded} />
            <Stat label="Documents rejected" value={d.quality.documentsRejected} tone={d.quality.documentsRejected ? "warn" : undefined} />
            <Stat label="Knowledge answers" value={d.knowledge.now} delta={d.knowledge.pct} />
            <Stat
              label="Backend error rate"
              value={`${d.quality.apiErrorRate}%`}
              sub={`${d.quality.apiCalls.toLocaleString("en-US")} calls`}
              tone={d.quality.apiErrorRate > 5 ? "crit" : d.quality.apiErrorRate > 1 ? "warn" : "pos"}
            />
          </div>
        </Panel>
      </div>

      {/* --------------------------------------------- UAE agentic AI standard */}
      <SectionHeading title="Against the UAE agentic AI standard" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Self-service rate" value={`${Math.max(0, 100 - d.escalations.rate)}%`} sub="no person needed" />
        <Stat label="Continuity" value={`${d.continuity.rate}%`} sub={`${d.continuity.resumed} of ${d.continuity.of} resumed on a later day`} />
        <Stat label="Median backend response" value={d.quality.apiMedianMs == null ? "—" : `${(d.quality.apiMedianMs / 1000).toFixed(1)}s`} />
        <Stat label="Served in Arabic" value={`${arabicShare}%`} sub={`${arabic.toLocaleString("en-US")} of ${servedTotal.toLocaleString("en-US")} conversations`} />
      </div>

      {/* ----------------------------------------------- operational monitoring */}
      <SectionHeading title="Operational monitoring" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={d.grain === "week" ? "Conversations per week" : "Conversations per day"} desc={`Every chat opened, by ${d.grain}.`}>
          <StackedDays days={d.conversationsPerDay.map((r) => ({ day: r.day, byJourney: { all: r.count }, total: r.count }))} keys={["all"]} label={() => "Conversations"} />
        </Panel>

        <Panel title="Language mix" desc="The language each conversation opened in.">
          <BarList data={d.languages.map((l) => ({ label: l.language, value: l.count }))} labelWidth="w-16" />
        </Panel>
      </div>

      {/* --------------------------------------------------- SLA and compliance */}
      <SectionHeading title="SLA and compliance" note="Open now" />
      {d.sla.total === 0 ? (
        <Panel title="Nothing breaching" desc="The reconciliation sweep found no payment stuck past its SLA and no callback overdue in this window.">
          <Empty what="No breaches detected." />
        </Panel>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {d.sla.byKind.map((k) => (
            <Stat key={k.kind} label={pretty(k.kind)} value={k.count} tone="warn" />
          ))}
        </div>
      )}

      {/* ------------------------------------------------------ what is missing */}
      <section className="rounded-2xl border border-dashed border-[var(--color-line)] bg-[var(--color-line-soft)] p-5">
        <h3 className="text-[13.5px] font-bold tracking-tight">Not on this page, and why</h3>
        <p className="mb-3 mt-0.5 text-[12.5px] text-muted">
          Every figure above is measured. These are on the agreed design and have no feed yet, so they are named here rather than
          estimated.
        </p>
        <ul className="flex flex-col gap-1.5">
          {d.notInstrumented.map((t) => (
            <li key={t} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-muted)]" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
