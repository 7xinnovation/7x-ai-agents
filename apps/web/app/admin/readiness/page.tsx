"use client";

/**
 * Agentic AI readiness — live assessment against the UAE guide's pre-launch gate.
 *
 * Every number on this page comes from /api/admin/readiness, which recomputes
 * from the deployed system on each request. Nothing is stored, so the page
 * cannot drift from reality: refresh it and it re-reads the configuration, the
 * connected backends and the audit trail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowUpRight, CheckCircle2, ChevronRight, CircleDashed,
  Info, RefreshCw, ShieldCheck, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const REFRESH_MS = 60_000;

// ── Types mirrored from lib/readiness.ts ─────────────────────────────────────
interface Check { label: string; ok: boolean; weight: number; detail: string; fix?: string; na?: boolean }
interface CriterionResult { criterionId: string; score: number; status: Status; checks: Check[] }
type Status = "complete" | "partial" | "gap";
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
const TONE: Record<Status, { fg: string; bg: string; ring: string; dot: string; label: string; labelAr: string }> = {
  complete: { fg: "text-[#067647]", bg: "bg-[#ecfdf3]", ring: "ring-[#abefc6]", dot: "bg-[#17b26a]", label: "Complete", labelAr: "مكتمل" },
  partial:  { fg: "text-[#b54708]", bg: "bg-[#fffaeb]", ring: "ring-[#fedf89]", dot: "bg-[#f79009]", label: "Partial",  labelAr: "جزئي" },
  gap:      { fg: "text-[#b42318]", bg: "bg-[#fef3f2]", ring: "ring-[#fecdca]", dot: "bg-[#f04438]", label: "Gap",      labelAr: "غير مكتمل" },
};
const statusOf = (n: number): Status => (n >= 85 ? "complete" : n >= 45 ? "partial" : "gap");
const hue = (n: number) => (n >= 85 ? "#17b26a" : n >= 45 ? "#f79009" : "#f04438");

function ScoreRing({ value, size = 172 }: { value: number; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  // Ease the arc up on load so the number reads as a live measurement settling,
  // not a static graphic.
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(t);
  }, [value]);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="stroke-[#eef0f4]" fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" strokeLinecap="round"
          stroke={hue(value)} strokeDasharray={circ}
          strokeDashoffset={circ - (circ * shown) / 100}
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <div className="text-[44px] font-semibold leading-none tracking-tight tabular-nums text-ink">{value}
          <span className="text-[20px] font-medium text-muted">%</span>
        </div>
        <div className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Readiness</div>
      </div>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setW(value)); return () => cancelAnimationFrame(t); }, [value]);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#eef0f4]">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: hue(value), transition: "width 0.9s cubic-bezier(0.16,1,0.3,1)" }} />
    </div>
  );
}

function Pill({ tone, children }: { tone: Status; children: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", t.bg, t.fg, t.ring)}>
      <span className={cn("size-1.5 rounded-full", t.dot)} />
      {children}
    </span>
  );
}

export default function ReadinessPage() {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("governance");
  const [tick, setTick] = useState(REFRESH_MS / 1000);
  const first = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/readiness", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail ?? j.error ?? `HTTP ${r.status}`);
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setTick(REFRESH_MS / 1000);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const i = setInterval(() => {
      setTick((t) => {
        if (t <= 1) { void load(); return REFRESH_MS / 1000; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(i);
  }, [load]);
  useEffect(() => { first.current = false; }, []);

  const sel = data?.byCriterion.find((c) => c.criterion.id === selected);

  /**
   * For the selected criterion, fold the six services' checks into one row per
   * requirement, recording which services satisfy it. Same label, different
   * outcome per service is the interesting case — that is where a criterion is
   * met for some journeys and not others.
   */
  const selChecks = useMemo(() => {
    if (!data || !sel) return [];
    const rows = new Map<string, { label: string; weight: number; pass: ServiceRef[]; fail: ServiceRef[]; na: ServiceRef[]; details: Map<string, ServiceRef[]>; fix?: string }>();
    for (const s of data.services) {
      const cr = s.criteria.find((c) => c.criterionId === sel.criterion.id);
      if (!cr) continue;
      for (const chk of cr.checks) {
        const row = rows.get(chk.label) ?? { label: chk.label, weight: chk.weight, pass: [], fail: [], na: [], details: new Map(), fix: chk.fix };
        (chk.na ? row.na : chk.ok ? row.pass : row.fail).push(s.service);
        const d = row.details.get(chk.detail) ?? [];
        d.push(s.service);
        row.details.set(chk.detail, d);
        if (!chk.ok && !chk.na && chk.fix) row.fix = chk.fix;
        rows.set(chk.label, row);
      }
    }
    // Unmet first — the page should lead with what is missing.
    return [...rows.values()].sort((a, b) => (a.fail.length ? 0 : 1) - (b.fail.length ? 0 : 1) || b.weight - a.weight);
  }, [data, sel]);

  const stats = useMemo(() => {
    if (!data) return null;
    const complete = data.byCriterion.filter((c) => c.status === "complete").length;
    const gaps = data.byCriterion.filter((c) => c.status === "gap").length;
    const openActions = data.suggestions.length;
    return { complete, gaps, openActions };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="tw grid min-h-[70vh] place-content-center gap-3 text-center">
        <RefreshCw className="mx-auto size-5 animate-spin text-brand" />
        <p className="text-sm text-muted">Assessing the deployed system…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="tw mx-auto mt-16 max-w-md rounded-xl border border-[#fecdca] bg-[#fef3f2] p-5 text-center">
        <AlertTriangle className="mx-auto mb-2 size-5 text-[#b42318]" />
        <p className="text-sm font-medium text-[#b42318]">Assessment failed</p>
        <p className="mt-1 text-xs text-[#b42318]/80">{error}</p>
        <button onClick={() => void load()} className="mt-3 rounded-lg bg-[#b42318] px-3 py-1.5 text-xs font-medium text-white">Retry</button>
      </div>
    );
  }
  if (!data || !stats) return null;

  const assessed = new Date(data.generatedAt);

  return (
    <div className="tw pb-16">
      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-2xl border border-line bg-ink px-6 py-7 text-white sm:px-8 sm:py-8" data-rise>
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{ background: "radial-gradient(900px 320px at 12% -10%, rgba(43,70,255,0.55), transparent 60%), radial-gradient(700px 300px at 92% 120%, rgba(0,32,245,0.35), transparent 62%)" }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-white/55">
              <ShieldCheck className="size-3.5" />
              UAE Agentic AI Guide · Pre-launch gate
            </div>
            <h1 className="mt-2.5 text-[26px] font-semibold leading-tight tracking-tight sm:text-[32px]">Readiness intelligence</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">
              Six government services assessed live against the guide&rsquo;s twelve pre-launch requirements. Every score is
              recomputed from the deployed configuration, the connected backends and the audit trail each time this page loads.
            </p>
            <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-white/45" dir="rtl" lang="ar">
              يجب أن يكون لكل متطلب دليل قابل للمراجعة والتدقيق، وليس تأكيداً وصفياً فقط
            </p>
          </div>
          <div className="flex flex-col items-end gap-2.5">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white/85 ring-1 ring-inset ring-white/15">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#17b26a] opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-[#17b26a]" />
              </span>
              Live · refreshes in {tick}s
            </span>
            <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-white/55 ring-1 ring-inset ring-white/10">
              Assessed {assessed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white/85 ring-1 ring-inset ring-white/15 transition hover:bg-white/15"
            >
              <RefreshCw className="size-3" /> Re-assess now
            </button>
          </div>
        </div>
      </header>

      {/* ── Score + headline stats ────────────────────────────────────────── */}
      <section className="mt-5 grid gap-4 lg:grid-cols-[auto_1fr]" data-rise>
        <div className="flex items-center gap-6 rounded-2xl border border-line bg-surface p-6 shadow-xs">
          <ScoreRing value={data.overall} />
          <div>
            <div className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
              TONE[statusOf(data.overall)].bg, TONE[statusOf(data.overall)].fg, TONE[statusOf(data.overall)].ring)}>
              <span className={cn("size-1.5 rounded-full", TONE[statusOf(data.overall)].dot)} />
              {data.band}
            </div>
            <p className="mt-3 max-w-[26ch] text-sm leading-relaxed text-ink-2">
              {stats.complete} of {data.byCriterion.length} requirements are fully met across all six services.
            </p>
            <p className="mt-2 max-w-[30ch] text-xs leading-relaxed text-muted">
              {stats.openActions} improvement{stats.openActions === 1 ? "" : "s"} identified from failed checks, ranked below by
              recoverable score.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Services in scope</h2>
              <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-inset ring-line">
                {data.services.length} live
              </span>
            </div>
            <ul className="space-y-3">
              {data.services.map((s) => (
                <li key={s.service.id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] text-ink-2">
                      <span className="mr-1.5 rounded bg-canvas px-1.5 py-0.5 text-[10px] font-semibold text-muted ring-1 ring-inset ring-line">{s.service.entity}</span>
                      {s.service.name}
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{s.score}%</span>
                  </div>
                  <Bar value={s.score} />
                </li>
              ))}
            </ul>
          </div>

          <div className="grid content-start gap-4">
            <div className="grid grid-cols-2 gap-4">
              {[
                { k: "Requirements met", v: `${stats.complete}/${data.byCriterion.length}`, sub: "across all six services" },
                { k: "Open gaps", v: String(stats.gaps), sub: "criteria below 45%" },
              ].map((t) => (
                <div key={t.k} className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t.k}</div>
                  <div className="mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-ink">{t.v}</div>
                  <div className="mt-1.5 text-[11px] text-muted">{t.sub}</div>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                <Activity className="size-3.5" /> Evidence recorded
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-3">
                {Object.entries(data.signals).map(([k, v]) => (
                  <div key={k}>
                    <dt className="truncate text-[11px] capitalize text-muted">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                    <dd className="font-semibold tabular-nums text-ink">{typeof v === "number" ? v.toLocaleString() : v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* ── The checklist matrix ──────────────────────────────────────────── */}
      <section className="mt-8" data-rise>
        <div className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">Pre-launch checklist</h2>
            <p className="mt-1 text-[13px] text-muted">
              <span dir="rtl" lang="ar">قائمة التحقق من الجاهزية</span> — twelve requirements, six services. Select a row to read its evidence.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted">
            {(Object.keys(TONE) as Status[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", TONE[s].dot)} />{TONE[s].label}
              </span>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-xs">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-surface px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Requirement
                </th>
                {data.services.map((s) => (
                  <th key={s.service.id} className="px-2.5 py-3 text-center text-[10px] font-medium leading-tight text-muted">
                    <div className="font-semibold text-ink-2">{s.service.entity}</div>
                    <div className="mx-auto mt-0.5 max-w-[9ch]">{s.service.name.replace(/^(New|Renew)\s/, (m) => m.trim() + " ")}</div>
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Overall</th>
              </tr>
            </thead>
            <tbody>
              {data.byCriterion.map((row) => {
                const active = row.criterion.id === selected;
                return (
                  <tr
                    key={row.criterion.id}
                    onClick={() => setSelected(row.criterion.id)}
                    className={cn("cursor-pointer border-b border-line-soft transition-colors last:border-0",
                      active ? "bg-[#f5f6ff]" : "hover:bg-canvas")}
                  >
                    <td className={cn("sticky left-0 z-10 px-5 py-3.5", active ? "bg-[#f5f6ff]" : "bg-surface")}>
                      <div className="flex items-center gap-2">
                        <ChevronRight className={cn("size-3.5 shrink-0 text-muted transition-transform", active && "rotate-90 text-brand")} />
                        <div className="min-w-0">
                          <div className={cn("truncate text-[13px] font-medium", active ? "text-brand" : "text-ink")}>{row.criterion.domain}</div>
                          <div className="truncate text-[11px] text-muted" dir="rtl" lang="ar">{row.criterion.domainAr}</div>
                        </div>
                      </div>
                    </td>
                    {data.services.map((s) => {
                      const c = s.criteria.find((x) => x.criterionId === row.criterion.id)!;
                      return (
                        <td key={s.service.id} className="px-2.5 py-3.5 text-center">
                          <span
                            className="inline-grid h-7 w-11 place-content-center rounded-md text-[12px] font-semibold tabular-nums"
                            style={{ background: `${hue(c.score)}1a`, color: hue(c.score) }}
                            title={`${s.service.name} · ${row.criterion.domain}: ${c.score}%`}
                          >
                            {c.score}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3.5 text-right">
                      <div className="inline-flex items-center gap-2.5">
                        <span className="w-16"><Bar value={row.score} /></span>
                        <span className="w-9 text-[13px] font-semibold tabular-nums text-ink">{row.score}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Evidence for the selected requirement ─────────────────────────── */}
      {sel && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6 shadow-xs" data-rise key={sel.criterion.id}>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
            <div className="min-w-0 max-w-3xl">
              <div className="flex items-center gap-2.5">
                <h3 className="text-[17px] font-semibold tracking-tight text-ink">{sel.criterion.domain}</h3>
                <Pill tone={sel.status}>{TONE[sel.status].label} · {TONE[sel.status].labelAr}</Pill>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{sel.criterion.requirement}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted" dir="rtl" lang="ar">{sel.criterion.requirementAr}</p>
            </div>
            <div className="text-right">
              <div className="text-[32px] font-semibold leading-none tabular-nums text-ink">{sel.score}<span className="text-lg text-muted">%</span></div>
              <div className="mt-1.5 text-[11px] text-muted">
                Evidence required: <span dir="rtl" lang="ar" className="font-medium text-ink-2">{sel.criterion.evidenceArtefact}</span>
              </div>
            </div>
          </div>

          <ul className="mt-1 divide-y divide-line-soft">
            {selChecks.map((row) => {
              const unmet = row.fail.length > 0;
              // Some checks only exist for a subset of services (a fee check has
              // no meaning where the journey has no fee), so the denominator is
              // how many services this check was actually applied to.
              const applied = row.pass.length + row.fail.length + row.na.length;
              const allNa = row.na.length === applied;
              return (
                <li key={row.label} className="py-4">
                  <div className="flex items-start gap-3">
                    {allNa ? <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted" />
                      : unmet ? <XCircle className="mt-0.5 size-4 shrink-0 text-[#f04438]" />
                      : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#17b26a]" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className={cn("text-[13px] font-medium", unmet ? "text-ink" : "text-ink-2")}>{row.label}</span>
                        {unmet && (
                          <span className="rounded-full bg-[#fef3f2] px-2 py-0.5 text-[10px] font-medium text-[#b42318] ring-1 ring-inset ring-[#fecdca]">
                            unmet in {row.fail.length} of {applied}
                          </span>
                        )}
                        {row.na.length > 0 && !allNa && (
                          <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] text-muted ring-1 ring-inset ring-line">
                            n/a for {row.na.length}
                          </span>
                        )}
                      </div>

                      {/* The auditable part: what was actually found, and where it differs by service. */}
                      <div className="mt-1.5 space-y-1.5">
                        {[...row.details.entries()].map(([detail, svcs]) => (
                          <p key={detail} className="text-[12.5px] leading-relaxed text-muted">
                            {row.details.size > 1 && (
                              <span className="mr-1.5 rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-2 ring-1 ring-inset ring-line">
                                {svcs.length === applied ? "all services" : svcs.map((s) => s.name).join(" · ")}
                              </span>
                            )}
                            {detail}
                          </p>
                        ))}
                      </div>

                      {unmet && row.fix && (
                        <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-[#fffaeb] px-3 py-2 ring-1 ring-inset ring-[#fedf89]">
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
        </section>
      )}

      {/* ── Ranked improvements ───────────────────────────────────────────── */}
      <section className="mt-8" data-rise>
        <div className="mb-3.5">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">What to fix next</h2>
          <p className="mt-1 text-[13px] text-muted">
            Derived from the checks that failed, ranked by the readiness score each one recovers across the portfolio.
          </p>
        </div>
        <ol className="space-y-2.5">
          {data.suggestions.map((s, i) => {
            const svcNames = s.services.length === data.services.length
              ? "all six services"
              : s.services.map((id) => data.services.find((x) => x.service.id === id)?.service.name).filter(Boolean).join(" · ");
            return (
              <li
                key={`${s.criterionId}-${i}`}
                className="group flex cursor-pointer items-start gap-4 rounded-xl border border-line bg-surface p-4 shadow-xs transition hover:border-ring hover:shadow-sm"
                onClick={() => { setSelected(s.criterionId); window.scrollTo({ top: 420, behavior: "smooth" }); }}
              >
                <div className="grid size-9 shrink-0 place-content-center rounded-lg bg-canvas text-[13px] font-semibold tabular-nums text-muted ring-1 ring-inset ring-line">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand">{s.domain}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                      s.severity === "critical" ? "bg-[#fef3f2] text-[#b42318] ring-[#fecdca]"
                        : s.severity === "high" ? "bg-[#fffaeb] text-[#b54708] ring-[#fedf89]"
                        : "bg-canvas text-muted ring-line")}>
                      {s.severity}
                    </span>
                    <span className="text-[11px] text-muted">{svcNames}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{s.fix}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[15px] font-semibold tabular-nums text-ink">+{s.impact}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">points</div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── How to read this ──────────────────────────────────────────────── */}
      <section className="mt-8 rounded-2xl border border-line bg-canvas p-5" data-rise>
        <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          <Info className="size-3.5" /> How this is measured
        </div>
        <ul className="space-y-2">
          {data.notes.map((n) => (
            <li key={n} className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink-2">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted" />
              {n}
            </li>
          ))}
        </ul>
        <p className="mt-3.5 border-t border-line pt-3 text-[11px] text-muted">
          Assessed {assessed.toLocaleString()} · source:{" "}
          <a className="text-brand underline-offset-2 hover:underline" href="https://uaemodel.egsep.ae/agentic_ai_guide_website.html" target="_blank" rel="noreferrer">
            uaemodel.egsep.ae — دليل الذكاء الاصطناعي الوكيل
          </a>
        </p>
      </section>
    </div>
  );
}
