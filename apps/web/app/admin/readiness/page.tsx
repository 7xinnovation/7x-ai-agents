"use client";

/**
 * Agentic AI readiness - live assessment against the UAE guide's pre-launch gate.
 *
 * Every number comes from /api/admin/readiness, which recomputes from the
 * deployed system on each request. Nothing is stored, so the page cannot drift
 * from reality: reload it and it re-reads the configuration, the connected
 * backends and the audit trail.
 *
 * Layout is master-detail rather than a wide table. Twelve requirements against
 * six services is a matrix that only fits by scrolling sideways, and the
 * evidence for a row rendered underneath it, so clicking row 12 put its own
 * evidence off-screen. The criteria list now carries a six-segment bar (one
 * segment per service) so the list itself is the matrix, and the evidence panel
 * sticks alongside it.
 *
 * Design decisions held constant across the page:
 *   radius  panels 16px, controls and cells 8px, pills full. No mixing.
 *   accent  brand blue for selection and links only. Green, amber and red are
 *           data encodings for complete/partial/gap, never decoration.
 *   motion  entry easing on the ring, nothing looping, everything collapsing to
 *           static under prefers-reduced-motion.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, ExternalLink,
  RefreshCw, ShieldCheck, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const REFRESH_MS = 60_000;

// ── Types mirrored from lib/readiness.ts ─────────────────────────────────────
interface Check { label: string; ok: boolean; weight: number; detail: string; fix?: string; na?: boolean }
type Status = "complete" | "partial" | "gap";
interface CriterionResult { criterionId: string; score: number; status: Status; checks: Check[] }
interface ServiceRef { id: string; agentSlug: string; journeyKey: string; name: string; nameAr: string; entity: string }
interface ServiceResult { service: ServiceRef; score: number; environment: string; criteria: CriterionResult[] }
interface Criterion { id: string; domain: string; domainAr: string; requirement: string; requirementAr: string; evidenceArtefact: string }
interface Suggestion { criterionId: string; domain: string; services: string[]; fix: string; impact: number; severity: "critical" | "high" | "medium" }
interface Report {
  generatedAt: string; overall: number; band: string;
  services: ServiceResult[];
  byCriterion: { criterion: Criterion; score: number; status: Status; servicesComplete: number }[];
  suggestions: Suggestion[];
  signals: Record<string, number | string>;
  notes: string[];
}

// ── Visual language ──────────────────────────────────────────────────────────
const TONE: Record<Status, { fg: string; bg: string; ring: string; solid: string; label: string }> = {
  complete: { fg: "text-[#067647]", bg: "bg-[#ecfdf3]", ring: "ring-[#abefc6]", solid: "#17b26a", label: "Complete" },
  partial:  { fg: "text-[#b54708]", bg: "bg-[#fffaeb]", ring: "ring-[#fedf89]", solid: "#f79009", label: "Partial" },
  gap:      { fg: "text-[#b42318]", bg: "bg-[#fef3f2]", ring: "ring-[#fecdca]", solid: "#f04438", label: "Gap" },
};
const statusOf = (n: number): Status => (n >= 85 ? "complete" : n >= 45 ? "partial" : "gap");
const hue = (n: number) => TONE[statusOf(n)].solid;

/** The project ships no animation library, so the preference is read directly. */
function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduce;
}

function ScoreRing({ value, size = 132 }: { value: number; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  // Ease the arc up once on load so the figure reads as a measurement settling.
  useEffect(() => {
    if (reduce) { setShown(value); return; }
    const f = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(f);
  }, [value, reduce]);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke="rgba(255,255,255,0.14)" fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" strokeLinecap="round"
          stroke={hue(value)} strokeDasharray={circ} strokeDashoffset={circ - (circ * shown) / 100}
          style={reduce ? undefined : { transition: "stroke-dashoffset 1s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <div className="text-[36px] font-semibold leading-none tracking-tight tabular-nums text-white">
          {value}<span className="text-[17px] font-medium text-white/45">%</span>
        </div>
      </div>
    </div>
  );
}

/** One segment per service, in service order, so a list row carries the matrix. */
function ServiceBars({ scores }: { scores: number[] }) {
  return (
    <div className="flex gap-[3px]" aria-hidden>
      {scores.map((s, i) => (
        <span
          key={i}
          className="h-3 w-1.5 rounded-[2px]"
          style={{ background: hue(s), opacity: 0.28 + (s / 100) * 0.72 }}
        />
      ))}
    </div>
  );
}

export default function ReadinessPage() {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("payment");
  const [tick, setTick] = useState(REFRESH_MS / 1000);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setRunning(true);
    const started = Date.now();
    try {
      const r = await fetch("/api/admin/readiness", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail ?? j.error ?? `HTTP ${r.status}`);
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Hold briefly so a manual run visibly happens even when nothing changed.
      const elapsed = Date.now() - started;
      if (elapsed < 550) await new Promise((res) => setTimeout(res, 550 - elapsed));
      setLoading(false);
      setRunning(false);
      setTick(REFRESH_MS / 1000);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => (t <= 1 ? (void load(), REFRESH_MS / 1000) : t - 1)), 1000);
    return () => clearInterval(i);
  }, [load]);

  const sel = data?.byCriterion.find((c) => c.criterion.id === selected);

  /**
   * Fold the six services' checks into one row per requirement, recording which
   * services satisfy it. The same label with a different outcome per service is
   * the interesting case: that is where a requirement holds for some journeys
   * and not others.
   */
  const selChecks = useMemo(() => {
    if (!data || !sel) return [];
    const rows = new Map<string, {
      label: string; weight: number;
      pass: ServiceRef[]; fail: ServiceRef[]; na: ServiceRef[];
      details: Map<string, ServiceRef[]>; fix?: string;
    }>();
    for (const s of data.services) {
      const cr = s.criteria.find((c) => c.criterionId === sel.criterion.id);
      if (!cr) continue;
      for (const chk of cr.checks) {
        const row = rows.get(chk.label)
          ?? { label: chk.label, weight: chk.weight, pass: [], fail: [], na: [], details: new Map(), fix: chk.fix };
        (chk.na ? row.na : chk.ok ? row.pass : row.fail).push(s.service);
        row.details.set(chk.detail, [...(row.details.get(chk.detail) ?? []), s.service]);
        if (!chk.ok && !chk.na && chk.fix) row.fix = chk.fix;
        rows.set(chk.label, row);
      }
    }
    // Unmet first: the panel should open on what is missing.
    return [...rows.values()].sort(
      (a, b) => (a.fail.length ? 0 : 1) - (b.fail.length ? 0 : 1) || b.weight - a.weight
    );
  }, [data, sel]);

  /** Unmet check count per criterion, for the badge on each list row. */
  const unmetByCriterion = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const s of data.services) {
      for (const cr of s.criteria) {
        const n = cr.checks.filter((c) => !c.ok && !c.na).length;
        m.set(cr.criterionId, (m.get(cr.criterionId) ?? 0) + n);
      }
    }
    return m;
  }, [data]);

  if (loading && !data) {
    return (
      <div className="grid min-h-[70vh] place-content-center gap-3 text-center">
        <RefreshCw className="mx-auto size-5 animate-spin text-brand" />
        <p className="text-sm text-muted">Reading the deployed system…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-[#fecdca] bg-[#fef3f2] p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 size-5 text-[#b42318]" />
        <p className="text-sm font-medium text-[#b42318]">Assessment failed</p>
        <p className="mt-1 text-xs text-[#b42318]/80">{error}</p>
        <button
          onClick={() => void load()}
          className="mt-4 rounded-lg bg-[#b42318] px-3.5 py-2 text-xs font-medium text-white transition active:translate-y-px"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!data) return null;

  const assessed = new Date(data.generatedAt);
  const met = data.byCriterion.filter((c) => c.status === "complete").length;
  const gaps = data.byCriterion.filter((c) => c.status === "gap").length;
  const headline = [
    { k: "Requirements met", v: `${met}/${data.byCriterion.length}` },
    { k: "Open gaps", v: String(gaps) },
    { k: "Actions", v: String(data.suggestions.length) },
    { k: "Backends", v: String(data.signals.backendEnvironment ?? "not set") },
    { k: "Gateway", v: String(data.signals.paymentGateway ?? "not set") },
  ];

  return (
    <div className="pb-16">
      {/* ── Command header. One dark panel carrying the score and the run
           control, so the light workspace below is unambiguously the data. ── */}
      <header className="relative overflow-hidden rounded-2xl bg-ink px-6 py-7 text-white sm:px-8">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(760px 300px at 8% -20%, rgba(43,70,255,0.42), transparent 62%), " +
              "radial-gradient(620px 280px at 96% 130%, rgba(0,32,245,0.26), transparent 64%)",
          }}
        />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 max-w-2xl">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
                <ShieldCheck className="size-3.5" />
                UAE Agentic AI guide
              </div>
              <h1 className="mt-3 text-[28px] font-semibold leading-[1.1] tracking-tight sm:text-[34px]">
                Pre-launch readiness
              </h1>
              <p className="mt-2.5 text-[14px] leading-relaxed text-white/65">
                Six government services measured against the guide&rsquo;s twelve requirements, recomputed from the
                deployed configuration every time this page loads.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-white/40" dir="rtl" lang="ar">
                يجب أن يكون لكل متطلب دليل قابل للمراجعة والتدقيق، وليس تأكيداً وصفياً فقط
              </p>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right">
                <button
                  onClick={() => void load()}
                  disabled={running}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-[13px] font-semibold text-ink transition",
                    running ? "cursor-wait opacity-65" : "hover:bg-white/90 active:translate-y-px"
                  )}
                >
                  <RefreshCw className={cn("size-3.5", running && "animate-spin")} />
                  {running ? "Reanalyzing…" : "Reanalyze"}
                </button>
                <p className="mt-3 text-[11px] text-white/45">
                  {running ? "Reading the live system" : `Next run in ${tick}s`}
                </p>
                <p className="mt-1 text-[11px] tabular-nums text-white/30">
                  {assessed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </p>
              </div>
              <div className="hidden sm:block">
                <ScoreRing value={data.overall} />
                <p className="mt-2 text-center text-[12px] font-medium text-white/70">{data.band}</p>
              </div>
            </div>
          </div>

          {/* Figures as one divided strip rather than five nested cards. */}
          <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-6 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-white/10">
            {headline.map((t, i) => (
              <div key={t.k} className={cn("min-w-0", i > 0 && "lg:pl-6")}>
                <dt className="truncate text-[11px] text-white/45">{t.k}</dt>
                <dd className="mt-1.5 truncate text-[19px] font-semibold leading-none tracking-tight tabular-nums text-white">
                  {t.v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      {/* ── Services. Also the legend for the six-segment bars below. ──────── */}
      <section className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        {data.services.map((s) => (
          <div key={s.service.id} className="min-w-0 rounded-lg border border-line bg-surface p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-semibold tracking-wide text-muted">{s.service.entity}</span>
              <span className="text-[15px] font-semibold tabular-nums" style={{ color: hue(s.score) }}>{s.score}%</span>
            </div>
            <p className="mt-1.5 truncate text-[12px] leading-snug text-ink-2">{s.service.name}</p>
          </div>
        ))}
      </section>

      {/* ── Master and detail ─────────────────────────────────────────────── */}
      <section className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(340px,400px)_1fr]">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-baseline justify-between border-b border-line px-4 py-3.5">
            <h2 className="text-[14px] font-semibold text-ink">Pre-launch checklist</h2>
            <span className="text-[11px] text-muted" dir="rtl" lang="ar">قائمة التحقق من الجاهزية</span>
          </div>
          <ul>
            {data.byCriterion.map((row) => {
              const active = row.criterion.id === selected;
              const unmet = unmetByCriterion.get(row.criterion.id) ?? 0;
              const scores = data.services.map(
                (s) => s.criteria.find((c) => c.criterionId === row.criterion.id)!.score
              );
              return (
                <li key={row.criterion.id}>
                  <button
                    onClick={() => setSelected(row.criterion.id)}
                    aria-current={active}
                    className={cn(
                      "relative flex w-full items-center gap-3 border-b border-line-soft px-4 py-3 text-left transition-colors last:border-0",
                      active ? "bg-[#f4f5ff]" : "hover:bg-canvas"
                    )}
                  >
                    {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("truncate text-[13px] font-medium", active ? "text-brand" : "text-ink")}>
                          {row.criterion.domain}
                        </span>
                        {unmet > 0 && (
                          <span className="shrink-0 rounded-full bg-[#fef3f2] px-1.5 py-px text-[10px] font-semibold tabular-nums text-[#b42318]">
                            {unmet}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5"><ServiceBars scores={scores} /></div>
                    </div>
                    <span className="shrink-0 text-[14px] font-semibold tabular-nums" style={{ color: hue(row.score) }}>
                      {row.score}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {sel && (
          <div className="min-w-0 rounded-2xl border border-line bg-surface xl:sticky xl:top-6">
            <div className="border-b border-line px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-[18px] font-semibold tracking-tight text-ink">{sel.criterion.domain}</h2>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                      TONE[sel.status].bg, TONE[sel.status].fg, TONE[sel.status].ring
                    )}>
                      {TONE[sel.status].label}
                    </span>
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{sel.criterion.requirement}</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted" dir="rtl" lang="ar">
                    {sel.criterion.requirementAr}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[30px] font-semibold leading-none tabular-nums" style={{ color: hue(sel.score) }}>
                    {sel.score}%
                  </div>
                  <p className="mt-2 text-[11px] text-muted">
                    Evidence: <span dir="rtl" lang="ar" className="font-medium text-ink-2">{sel.criterion.evidenceArtefact}</span>
                  </p>
                </div>
              </div>

              {/* Per-service scores for this requirement, in the strip's order. */}
              <div className="mt-5 grid grid-cols-3 gap-2 lg:grid-cols-6">
                {data.services.map((s) => {
                  const c = s.criteria.find((x) => x.criterionId === sel.criterion.id)!;
                  return (
                    <div key={s.service.id} className="min-w-0 rounded-lg bg-canvas px-2.5 py-2">
                      {/* Keep the New/Renew prefix: dropping it makes the two
                          journeys of the same product read identically. */}
                      <div className="truncate text-[10px] text-muted" title={`${s.service.entity} ${s.service.name}`}>
                        {s.service.name}
                      </div>
                      <div className="mt-1 text-[14px] font-semibold tabular-nums" style={{ color: hue(c.score) }}>
                        {c.score}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <ul className="divide-y divide-line-soft px-6">
              {selChecks.map((row) => {
                const applied = row.pass.length + row.fail.length + row.na.length;
                const unmet = row.fail.length > 0;
                const allNa = row.na.length === applied;
                return (
                  <li key={row.label} className="py-4">
                    <div className="flex items-start gap-3">
                      {allNa
                        ? <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted" />
                        : unmet
                          ? <XCircle className="mt-0.5 size-4 shrink-0 text-[#f04438]" />
                          : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#17b26a]" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className={cn("text-[13px] font-medium", unmet ? "text-ink" : "text-ink-2")}>
                            {row.label}
                          </span>
                          {unmet && (
                            <span className="rounded-full bg-[#fef3f2] px-2 py-0.5 text-[10px] font-medium text-[#b42318]">
                              unmet in {row.fail.length} of {applied}
                            </span>
                          )}
                          {row.na.length > 0 && !allNa && (
                            <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] text-muted">
                              n/a for {row.na.length}
                            </span>
                          )}
                        </div>

                        {/* The auditable part: what was found, and where services differ. */}
                        <div className="mt-1.5 space-y-1.5">
                          {[...row.details.entries()].map(([detail, svcs]) => (
                            <p key={detail} className="text-[12.5px] leading-relaxed text-muted">
                              {row.details.size > 1 && (
                                <span className="mr-1.5 rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
                                  {svcs.length === applied ? "all services" : svcs.map((s) => s.name).join(", ")}
                                </span>
                              )}
                              {detail}
                            </p>
                          ))}
                        </div>

                        {unmet && row.fix && (
                          <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-[#fffaeb] px-3 py-2">
                            <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-[#b54708]" />
                            <p className="text-[12.5px] leading-relaxed text-[#93370d]">{row.fix}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* ── Ranked actions ────────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="mb-3.5 flex items-baseline justify-between gap-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">What to fix next</h2>
          <p className="text-[12px] text-muted">Ranked by readiness points recovered</p>
        </div>
        <ol className="overflow-hidden rounded-2xl border border-line bg-surface">
          {data.suggestions.map((s, i) => {
            const hit = s.services
              .map((id) => data.services.find((x) => x.service.id === id)?.service)
              .filter(Boolean) as ServiceRef[];
            // Naming four journeys is noise when they are simply one entity's
            // whole portfolio. Collapse to "all NXN services" in that case.
            const entities = [...new Set(hit.map((h) => h.entity))];
            const coversEntity =
              entities.length === 1 &&
              hit.length === data.services.filter((x) => x.service.entity === entities[0]).length;
            const names = hit.length === data.services.length
              ? "all six services"
              : coversEntity
                ? `all ${entities[0]} services`
                : hit.map((h) => h.name).join(", ");
            return (
              <li key={`${s.criterionId}-${i}`}>
                <button
                  onClick={() => { setSelected(s.criterionId); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  className="flex w-full items-start gap-4 border-b border-line-soft px-5 py-4 text-left transition-colors last:border-0 hover:bg-canvas"
                >
                  <span className="mt-0.5 w-5 shrink-0 text-[13px] font-semibold tabular-nums text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-brand">{s.domain}</span>
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        s.severity === "critical" ? "bg-[#fef3f2] text-[#b42318]"
                          : s.severity === "high" ? "bg-[#fffaeb] text-[#b54708]"
                          : "bg-canvas text-muted"
                      )}>
                        {s.severity}
                      </span>
                      <span className="text-[11px] text-muted">{names}</span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{s.fix}</p>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block text-[14px] font-semibold tabular-nums text-ink">+{s.impact}</span>
                    <span className="block text-[10px] text-muted">pts</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── Method ────────────────────────────────────────────────────────── */}
      <section className="mt-8 border-t border-line pt-5">
        <h2 className="text-[12px] font-semibold text-ink">How this is measured</h2>
        <ul className="mt-2.5 grid gap-2 lg:grid-cols-3">
          {data.notes.map((n) => (
            <li key={n} className="text-[12px] leading-relaxed text-muted">{n}</li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] text-muted">
          Assessed {assessed.toLocaleString()} ·{" "}
          <a
            className="inline-flex items-center gap-1 text-brand underline-offset-2 hover:underline"
            href="https://uaemodel.egsep.ae/agentic_ai_guide_website.html"
            target="_blank"
            rel="noreferrer"
          >
            uaemodel.egsep.ae <ExternalLink className="size-3" />
          </a>
        </p>
      </section>
    </div>
  );
}
