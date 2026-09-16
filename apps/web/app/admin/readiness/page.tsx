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
 * sticks alongside it. The header carries the inverse cut: one segment per
 * requirement, so the whole gate is readable before any scrolling.
 *
 * Design decisions held constant across the page:
 *   radius  panels 16px, controls and cells 8px, pills full. No mixing.
 *   accent  brand blue for selection and links only. Green, amber and red are
 *           data encodings for complete/partial/gap, never decoration.
 *   motion  everything animated communicates a state change and nothing loops:
 *           the ring settles once, delta chips mark what the last run moved,
 *           counters flash when their figure changed, the countdown ring shows
 *           the next re-run approaching. All of it collapses to static under
 *           prefers-reduced-motion.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, Download,
  ExternalLink, FileSpreadsheet, RefreshCw, ShieldCheck, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types mirrored from lib/readiness.ts ─────────────────────────────────────
interface Check { label: string; ok: boolean; weight: number; detail: string; fix?: string; na?: boolean }
type Status = "complete" | "partial" | "gap";
interface CriterionResult { criterionId: string; score: number; status: Status; checks: Check[] }
interface ServiceRef { id: string; agentSlug: string; journeyKey: string; name: string; nameAr: string; entity: string }
interface ServiceResult { service: ServiceRef; score: number; environment: string; criteria: CriterionResult[] }
interface Criterion { id: string; domain: string; domainAr: string; requirement: string; requirementAr: string; evidenceArtefact: string }
interface Suggestion { criterionId: string; domain: string; services: string[]; fix: string; impact: number; severity: "critical" | "high" | "medium" }
interface EntityPosition {
  criterionId: string; check?: string; asked: string; stated: string;
  by: string; on: string; ref: string; kind: "confirmed" | "committed" | "question";
}
interface Report {
  generatedAt: string; overall: number; band: string;
  services: ServiceResult[];
  byCriterion: { criterion: Criterion; score: number; status: Status; servicesComplete: number; artefact?: { file: string; received: string } }[];
  suggestions: Suggestion[];
  positions?: EntityPosition[];
  signals: Record<string, number | string>;
  notes: string[];
}

/** What the previous run scored, so a re-run shows what it moved. */
interface Deltas {
  overall: number;
  criterion: Record<string, number>;
  service: Record<string, number>;
  signals: Record<string, boolean>;
}

// ── Visual language ──────────────────────────────────────────────────────────
const TONE: Record<Status, { fg: string; bg: string; ring: string; solid: string; label: string }> = {
  complete: { fg: "text-[#067647]", bg: "bg-[#ecfdf3]", ring: "ring-[#abefc6]", solid: "#17b26a", label: "Complete" },
  partial:  { fg: "text-[#b54708]", bg: "bg-[#fffaeb]", ring: "ring-[#fedf89]", solid: "#f79009", label: "Partial" },
  gap:      { fg: "text-[#b42318]", bg: "bg-[#fef3f2]", ring: "ring-[#fecdca]", solid: "#f04438", label: "Gap" },
};
const statusOf = (n: number): Status => (n >= 85 ? "complete" : n >= 45 ? "partial" : "gap");
const hue = (n: number) => TONE[statusOf(n)].solid;

/** Live counters worth showing beside the scores, in reading order. */
const EVIDENCE_FIGURES: { key: string; label: string }[] = [
  { key: "conversations", label: "Conversations" },
  { key: "journeysStarted", label: "Journeys started" },
  { key: "journeysCompleted", label: "Journeys completed" },
  { key: "paymentsCompleted", label: "Payments confirmed" },
  { key: "callbacks", label: "Callbacks raised" },
  { key: "auditedActions", label: "Audited actions" },
  { key: "knowledgeRetrievals", label: "Grounded answers" },
];

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

/**
 * One-shot ease from the previous figure to the new one. Runs only when the
 * target actually changes, so the sixty-second refresh does not re-animate a
 * score that stayed put.
 */
function useCountUp(target: number, duration = 1000) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (reduce) { fromRef.current = target; setShown(target); return; }
    const from = fromRef.current;
    if (from === target) { setShown(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);
  return shown;
}

/** Marks what the last run moved. Absent when nothing changed, so silence
    means stability rather than a stream of zeros. */
function DeltaChip({ d, onDark = false }: { d?: number; onDark?: boolean }) {
  if (!d) return null;
  const up = d > 0;
  return (
    <span
      data-delta
      title="Change since the previous run"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
        onDark
          ? cn("bg-white/10", up ? "text-[#75e0a7]" : "text-[#fda29b]")
          : up ? "bg-[#ecfdf3] text-[#067647]" : "bg-[#fef3f2] text-[#b42318]"
      )}
    >
      {up ? "+" : ""}{d}
    </span>
  );
}

function ScoreRing({ value, size = 132 }: { value: number; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const figure = useCountUp(value);
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
          {figure}<span className="text-[17px] font-medium text-white/45">%</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The federal checklist (Agentic AI Checklist.xlsx) with its empty Status
 * column filled from the live scores - the same three columns, in Arabic, so
 * what we export is the document the reviewers actually submit. UTF-8 BOM so
 * Excel renders the Arabic instead of mojibake.
 */
const STATUS_AR: Record<Status, string> = { complete: "مكتمل", partial: "مكتمل جزئياً", gap: "غير مكتمل" };
function exportChecklist(data: Report) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [
    ["المجال والمتطلب", "الدليل المطلوب", "الحالة"],
    ...data.byCriterion.map((r) => [
      `${r.criterion.domainAr}\n${r.criterion.requirementAr}`,
      r.criterion.evidenceArtefact,
      `${STATUS_AR[r.status]} (${r.score}%)`,
    ]),
  ];
  const csv = "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `agentic-ai-checklist-status-${data.generatedAt.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** One segment per service, in service order, so a list row carries the matrix.
    Hovering a segment names the service it stands for. */
function ServiceBars({ scores, services }: { scores: number[]; services: ServiceRef[] }) {
  return (
    <div className="flex gap-[3px]">
      {scores.map((s, i) => (
        <span
          key={i}
          title={`${services[i]?.entity ?? ""} ${services[i]?.name ?? ""}: ${s}%`.trim()}
          className="h-3 w-[7px] rounded-[2px]"
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
  const [running, setRunning] = useState(false);
  const [delta, setDelta] = useState<Deltas | null>(null);
  const prevRef = useRef<Report | null>(null);
  const boardRef = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();

  const load = useCallback(async () => {
    setRunning(true);
    const started = Date.now();
    try {
      const r = await fetch("/api/admin/readiness", { cache: "no-store" });
      const j: Report = await r.json();
      if (!r.ok) throw new Error((j as any).detail ?? (j as any).error ?? `HTTP ${r.status}`);
      // Diff against the previous run before replacing it, so the page can say
      // what this run changed instead of silently repainting the same numbers.
      const prev = prevRef.current;
      if (prev) {
        const criterion: Record<string, number> = {};
        for (const c of j.byCriterion) {
          const p = prev.byCriterion.find((x) => x.criterion.id === c.criterion.id);
          if (p && p.score !== c.score) criterion[c.criterion.id] = c.score - p.score;
        }
        const service: Record<string, number> = {};
        for (const s of j.services) {
          const p = prev.services.find((x) => x.service.id === s.service.id);
          if (p && p.score !== s.score) service[s.service.id] = s.score - p.score;
        }
        const signals: Record<string, boolean> = {};
        for (const f of EVIDENCE_FIGURES) {
          if (Number(prev.signals[f.key] ?? 0) !== Number(j.signals[f.key] ?? 0)) signals[f.key] = true;
        }
        setDelta({ overall: j.overall - prev.overall, criterion, service, signals });
      }
      prevRef.current = j;
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
    }
  }, []);

  // Read once when the page opens, and after that only when someone asks.
  //
  // It used to re-run every sixty seconds. A full assessment reads every agent,
  // every integration and the live system behind them, so a tab left open on a
  // wall display ran it all day — and the score moving on its own, with a
  // countdown ticking beside it, reads as something happening rather than as a
  // page refreshing itself.
  useEffect(() => { void load(); }, [load]);

  /**
   * Selection with an optional landing spot. "board" brings the master-detail
   * into view (from the header strip or the actions list); "detail" brings the
   * evidence panel up, which only matters below xl where it sits under the
   * list rather than beside it.
   */
  const selectCriterion = useCallback((id: string, scroll?: "board" | "detail") => {
    setSelected(id);
    if (!scroll) return;
    requestAnimationFrame(() => {
      const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
      if (scroll === "board") boardRef.current?.scrollIntoView({ behavior, block: "start" });
      else if (window.innerWidth < 1280) detailRef.current?.scrollIntoView({ behavior, block: "start" });
    });
  }, [reduce]);

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

  /** How much was actually examined, across every service and criterion. */
  const checkTotals = useMemo(() => {
    let met = 0, unmet = 0, na = 0;
    for (const s of data?.services ?? []) {
      for (const cr of s.criteria) {
        for (const c of cr.checks) {
          if (c.na) na++;
          else if (c.ok) met++;
          else unmet++;
        }
      }
    }
    return { met, unmet, na, applied: met + unmet };
  }, [data]);

  /** NXN against EPGL, since the two agents differ materially. */
  const entityRollup = useMemo(() => {
    const by = new Map<string, number[]>();
    for (const s of data?.services ?? []) {
      by.set(s.service.entity, [...(by.get(s.service.entity) ?? []), s.score]);
    }
    return [...by.entries()].map(([entity, scores]) => ({
      entity,
      count: scores.length,
      score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }));
  }, [data]);

  /** Total readiness recoverable if every listed action were taken. */
  const recoverable = useMemo(
    () => Math.round((data?.suggestions ?? []).reduce((n, s) => n + s.impact, 0) * 10) / 10,
    [data]
  );

  if (loading && !data) {
    // Skeleton in the shape of the finished page, so the load reads as the
    // board assembling rather than a generic wait.
    return (
      <div className="pb-16" role="status" aria-label="Reading the deployed system">
        <div className="rounded-2xl bg-ink px-6 py-7 sm:px-8">
          <div className="animate-pulse motion-reduce:animate-none">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div>
                <div className="h-3 w-44 rounded bg-white/10" />
                <div className="mt-4 h-8 w-72 rounded bg-white/10" />
              </div>
              <div className="hidden h-[132px] w-[132px] rounded-full border-8 border-white/10 sm:block" />
            </div>
            <div className="mt-7 flex gap-1 border-t border-white/10 pt-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-1.5 flex-1 rounded-full bg-white/10" />
              ))}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <div className="h-2.5 w-20 rounded bg-white/10" />
                  <div className="mt-2.5 h-4 w-12 rounded bg-white/10" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[106px] animate-pulse rounded-lg border border-line bg-surface motion-reduce:animate-none" />
          ))}
        </div>
        <div className="mt-5 h-[120px] animate-pulse rounded-2xl border border-line bg-surface motion-reduce:animate-none" />
        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(340px,400px)_1fr]">
          <div className="h-[540px] animate-pulse rounded-2xl border border-line bg-surface motion-reduce:animate-none" />
          <div className="h-[540px] animate-pulse rounded-2xl border border-line bg-surface motion-reduce:animate-none" />
        </div>
        <p className="mt-6 text-center text-sm text-muted">Reading the deployed system…</p>
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
  const partial = data.byCriterion.length - met - gaps;
  const headline = [
    { k: "Requirements met", v: `${met}/${data.byCriterion.length}` },
    { k: "Open gaps", v: String(gaps) },
    { k: "Actions", v: String(data.suggestions.length) },
    { k: "Backends", v: String(data.signals.backendEnvironment ?? "not set") },
    { k: "Gateway", v: String(data.signals.paymentGateway ?? "not set") },
  ];
  const maxImpact = Math.max(...data.suggestions.map((s) => s.impact), 1);

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
          {/* The title block is short now, so it centres against the ring
              rather than hanging from the top with a gap beneath it. */}
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="min-w-0 max-w-2xl">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
                <ShieldCheck className="size-3.5" />
                UAE Agentic AI guide
              </div>
              <h1 className="mt-3 text-[28px] font-semibold leading-[1.1] tracking-tight sm:text-[34px]">
                Pre-launch readiness
              </h1>
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
                <p className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-white/45">
                  {running ? "Reading the live system" : "Assessed"}
                </p>
                <p className="mt-1 text-[11px] tabular-nums text-white/30">
                  {assessed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </p>
              </div>
              <div className="hidden sm:block">
                <ScoreRing value={data.overall} />
                <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[12px] font-medium text-white/70">
                  {data.band}
                  <DeltaChip d={delta?.overall} onDark />
                </p>
              </div>
            </div>
          </div>

          {/* The gate at a glance: one segment per requirement, in checklist
              order. Clicking a segment opens that requirement's evidence. */}
          <div className="mt-7 border-t border-white/10 pt-6">
            <div className="mb-2 flex items-baseline justify-between gap-3 text-[11px] text-white/45">
              <span>Requirement status</span>
              <span className="tabular-nums">{met} complete, {partial} partial, {gaps} {gaps === 1 ? "gap" : "gaps"}</span>
            </div>
            <div className="flex gap-1">
              {data.byCriterion.map((row) => (
                <button
                  key={row.criterion.id}
                  onClick={() => selectCriterion(row.criterion.id, "board")}
                  title={`${row.criterion.domain}: ${row.score}%`}
                  aria-label={`${row.criterion.domain}, ${row.score} percent, ${TONE[row.status].label}. Open evidence.`}
                  className="group min-w-0 flex-1 py-1"
                >
                  <span
                    className={cn(
                      "block h-1.5 rounded-full transition-transform group-hover:scale-y-150",
                      row.criterion.id === selected && "shadow-[0_0_0_1.5px_rgba(255,255,255,0.65)]"
                    )}
                    style={{ background: TONE[row.status].solid }}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Figures as one divided strip rather than five nested cards. */}
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-white/10">
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
      <section className="mt-6">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-ink">Services in scope</h2>
          <div className="flex items-center gap-2">
            {entityRollup.map((e) => (
              <span key={e.entity} className="rounded-full bg-surface px-2.5 py-1 text-[11px] text-muted ring-1 ring-inset ring-line">
                {e.entity} <span className="font-semibold tabular-nums" style={{ color: hue(e.score) }}>{e.score}%</span>
                <span className="ml-1 text-muted">across {e.count}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          {data.services.map((s) => (
            <div key={s.service.id} className="min-w-0 rounded-lg border border-line bg-surface p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold tracking-wide text-muted">{s.service.entity}</span>
                <span className="flex items-center gap-1.5">
                  <DeltaChip d={delta?.service[s.service.id]} />
                  <span className="text-[15px] font-semibold tabular-nums" style={{ color: hue(s.score) }}>{s.score}%</span>
                </span>
              </div>
              <p className="mt-1.5 truncate text-[12px] leading-snug text-ink-2" title={s.service.name}>{s.service.name}</p>
              <p className="mt-1 truncate text-[10px] text-muted" dir="rtl" lang="ar">{s.service.nameAr}</p>
              <div className="mt-2.5 flex items-center justify-between border-t border-line-soft pt-2 text-[10px] text-muted">
                <span>{s.criteria.filter((c) => c.status === "complete").length}/{s.criteria.length} met</span>
                <span className="tabular-nums">{s.environment}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── What the assessment could actually observe. These counts are the
           difference between a claim and a measurement, so they are shown
           rather than folded into the scores. ─────────────────────────────── */}
      <section className="mt-5 rounded-2xl border border-line bg-surface px-6 py-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-ink">Evidence on record</h2>
          <p className="text-[11px] text-muted">
            {checkTotals.applied.toLocaleString()} checks across {data.services.length} services ·{" "}
            {checkTotals.met.toLocaleString()} met, {checkTotals.unmet.toLocaleString()} unmet,{" "}
            {checkTotals.na.toLocaleString()} not applicable
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-7 lg:divide-x lg:divide-line">
          {EVIDENCE_FIGURES.map((f, i) => {
            const v = Number(data.signals[f.key] ?? 0);
            return (
              <div key={f.key} className={cn("min-w-0", i > 0 && "lg:pl-6")}>
                <dt className="truncate text-[11px] text-muted" title={f.label}>{f.label}</dt>
                {/* Keyed by value: a counter that moved between runs remounts
                    and settles from brand blue back to ink. */}
                <dd
                  key={v}
                  data-flash={delta?.signals[f.key] ? "" : undefined}
                  className="mt-1.5 text-[18px] font-semibold leading-none tabular-nums text-ink"
                >
                  {v.toLocaleString()}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      {/* ── Master and detail ─────────────────────────────────────────────── */}
      <section ref={boardRef} className="mt-5 grid scroll-mt-6 items-start gap-5 xl:grid-cols-[minmax(340px,400px)_1fr]">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-ink">Pre-launch checklist</h2>
              <span className="text-[11px] text-muted" dir="rtl" lang="ar">قائمة التحقق من الجاهزية</span>
            </div>
            {/* The reviewers' own workbook with its Status column filled in. */}
            <button
              onClick={() => exportChecklist(data)}
              title="Download the federal checklist (Agentic AI Checklist) with the Status column filled from these live scores"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted ring-1 ring-inset ring-line transition-colors hover:bg-canvas hover:text-ink active:translate-y-px"
            >
              <Download className="size-3.5" />
              Export
            </button>
          </div>
          <ul>
            {data.byCriterion.map((row, idx) => {
              const active = row.criterion.id === selected;
              const unmet = unmetByCriterion.get(row.criterion.id) ?? 0;
              const scores = data.services.map(
                (s) => s.criteria.find((c) => c.criterionId === row.criterion.id)!.score
              );
              return (
                <li key={row.criterion.id}>
                  <button
                    onClick={() => selectCriterion(row.criterion.id, "detail")}
                    onKeyDown={(e) => {
                      // Arrow keys walk the checklist without leaving the list.
                      const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                      if (!dir) return;
                      const next = data.byCriterion[idx + dir];
                      if (!next) return;
                      e.preventDefault();
                      selectCriterion(next.criterion.id);
                      e.currentTarget.closest("ul")
                        ?.querySelectorAll<HTMLButtonElement>("button")[idx + dir]?.focus();
                    }}
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
                      <div className="mt-1.5 flex items-center gap-2">
                        <ServiceBars scores={scores} services={data.services.map((s) => s.service)} />
                        <span className="text-[10px] tabular-nums text-muted">
                          {row.servicesComplete}/{data.services.length} met
                        </span>
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <DeltaChip d={delta?.criterion[row.criterion.id]} />
                      <span className="text-[14px] font-semibold tabular-nums" style={{ color: hue(row.score) }}>
                        {row.score}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {sel && (
          <div ref={detailRef} className="min-w-0 scroll-mt-6 rounded-2xl border border-line bg-surface xl:sticky xl:top-6">
            {/* Keyed by criterion so switching rows re-enters the panel: the
                rise marks that the evidence now describes a different row. */}
            <div key={sel.criterion.id} data-rise>
            <div className="border-b border-line px-6 py-5">
              {/* Score sits on the title line. In a right-hand column it wrapped
                  under the requirement text on narrower panels, where text-right
                  no longer means anything and the figure floated mid-paragraph. */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <h2 className="text-[18px] font-semibold tracking-tight text-ink">{sel.criterion.domain}</h2>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                    TONE[sel.status].bg, TONE[sel.status].fg, TONE[sel.status].ring
                  )}>
                    {TONE[sel.status].label}
                  </span>
                </div>
                <span
                  className="shrink-0 text-[28px] font-semibold leading-none tabular-nums"
                  style={{ color: hue(sel.score) }}
                >
                  {sel.score}%
                </span>
              </div>

              {/* Arabic runs inline in brackets rather than as its own RTL line.
                  The brackets live INSIDE the isolate: left outside, they are
                  neutral characters that get re-resolved when the Arabic wraps,
                  and both ends render as an opening bracket on separate lines.
                  Trailing full stop dropped, since it sits inside parentheses
                  that already follow the English sentence. */}
              <p className="mt-2.5 max-w-3xl text-[13.5px] leading-relaxed text-ink-2">
                {sel.criterion.requirement}{" "}
                <bdi dir="rtl" lang="ar" className="text-muted">
                  ({sel.criterion.requirementAr.replace(/\s*[.]\s*$/, "")})
                </bdi>
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
                <span>
                  Evidence required:{" "}
                  <bdi lang="ar" className="font-medium text-ink-2">{sel.criterion.evidenceArtefact}</bdi>
                </span>
                <span className="text-line">|</span>
                {/* Whether the reviewer-facing workbook for this criterion has
                    actually been prepared - the one thing scores cannot show. */}
                {sel.artefact ? (
                  <span className="inline-flex items-center gap-1.5" title={sel.artefact.file}>
                    <FileSpreadsheet className="size-3.5 text-[#067647]" />
                    Artefact on file, received {sel.artefact.received}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <FileSpreadsheet className="size-3.5 text-[#b42318]" />
                    No artefact prepared yet
                  </span>
                )}
                <span className="text-line">|</span>
                <span>
                  {selChecks.length} requirements checked ·{" "}
                  <span className="font-medium text-[#b42318]">
                    {selChecks.filter((r) => r.fail.length).length} unmet
                  </span>
                </span>
                <span className="text-line">|</span>
                <span>Met in {sel.servicesComplete} of {data.services.length} services</span>
              </div>

              {/* Per-service scores for this requirement, in the strip's order.
                  Each cell is tinted by its status, so the split between
                  passing and failing services reads before the numbers do. */}
              <div className="mt-5 grid grid-cols-3 gap-2 lg:grid-cols-6">
                {data.services.map((s) => {
                  const c = s.criteria.find((x) => x.criterionId === sel.criterion.id)!;
                  return (
                    <div key={s.service.id} className={cn("min-w-0 rounded-lg px-2.5 py-2", TONE[c.status].bg)}>
                      {/* Keep the New/Renew prefix: dropping it makes the two
                          journeys of the same product read identically. */}
                      <div
                        className={cn("truncate text-[10px] opacity-75", TONE[c.status].fg)}
                        title={`${s.service.entity} ${s.service.name}`}
                      >
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

            {/* Positions the entity gave against the CRITERION rather than one of
                its checks — a commitment to change wording, say. */}
            {(data?.positions ?? []).filter((p) => p.criterionId === sel.criterion.id && !p.check).length > 0 && (
              <div className="grid gap-2 px-6 pb-4">
                {(data?.positions ?? [])
                  .filter((p) => p.criterionId === sel.criterion.id && !p.check)
                  .map((p) => (
                    <div key={p.ref + p.stated} className="rounded-lg border border-[var(--color-line)] bg-canvas px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          p.kind === "confirmed" ? "bg-[#ecfdf3] text-[#067647]"
                            : p.kind === "committed" ? "bg-[#fffaeb] text-[#b54708]"
                              : "bg-[#eff4ff] text-[#004eeb]")}>
                          {p.kind === "question" ? "asked back" : p.kind}
                        </span>
                        <span className="text-[11px] text-muted">{p.by} · {p.on} · {p.ref}</span>
                      </div>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{p.asked}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink">“{p.stated}”</p>
                    </div>
                  ))}
              </div>
            )}

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
                          {/* Weight makes the arithmetic legible: a reviewer can
                              see why one unmet check moves the score further
                              than another. */}
                          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted">
                            weight {row.weight}
                          </span>
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

                        {/* WHAT THE ENTITY SAID ABOUT THIS ONE. Their answer sits
                            beside the measurement rather than in a feedback tool,
                            and never in place of it: a statement moves nothing. */}
                        {(data?.positions ?? [])
                          .filter((p) => p.criterionId === sel.criterion.id && p.check === row.label)
                          .map((p) => (
                            <div key={p.ref + p.stated} className="mt-2 rounded-lg border border-[var(--color-line)] bg-canvas px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                  p.kind === "confirmed" ? "bg-[#ecfdf3] text-[#067647]"
                                    : p.kind === "committed" ? "bg-[#fffaeb] text-[#b54708]"
                                      : "bg-[#eff4ff] text-[#004eeb]")}>
                                  {p.kind === "question" ? "asked back" : p.kind}
                                </span>
                                <span className="text-[11px] text-muted">{p.by} · {p.on} · {p.ref}</span>
                              </div>
                              <p className="mt-1 text-[12.5px] leading-relaxed text-ink">“{p.stated}”</p>
                            </div>
                          ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            </div>
          </div>
        )}
      </section>

      {/* ── Ranked actions ────────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">What to fix next</h2>
          {/* Deliberately not "takes readiness to 100%": the actions close every
              gap this assessment can observe, which is not the same as passing
              the federal gate. */}
          <p className="text-[12px] text-muted">
            {data.suggestions.length} actions worth{" "}
            <span className="font-semibold text-ink">+{recoverable} points</span>, closing every gap the
            assessment can currently see
          </p>
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
                  onClick={() => selectCriterion(s.criterionId, "board")}
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
                    {/* Length against the biggest action on the list, so relative
                        payoff scans without reading the numbers. */}
                    <span
                      className="ml-auto mt-1.5 block h-[3px] rounded-full bg-ink/20"
                      style={{ width: `${Math.max(10, Math.round((s.impact / maxImpact) * 44))}px` }}
                      aria-hidden
                    />
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
