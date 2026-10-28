import type { ReactNode } from "react";

/**
 * The chart vocabulary for the insights page.
 *
 * Six forms, no chart library. Every one is plain HTML in the admin's own
 * tokens, which is why the page renders on the server with no hydration and why
 * it looks like the rest of the console rather than like a plotting default.
 *
 * COLOUR IS ASSIGNED BY JOB, NOT BY TASTE.
 *
 *  - `SERIES` is categorical: identity only, assigned in fixed order and never
 *    cycled. Slot 1 is the 7X brand blue. The order was validated against the
 *    white console surface — worst adjacent colour-vision separation ΔE 9.1,
 *    worst normal-vision ΔE 19.6 — so a reader with deuteranopia or protanopia
 *    can still tell neighbouring journeys apart.
 *  - `RAMP` is ordinal: one hue, light to dark, for the funnel's ordered rungs.
 *    It starts no lighter than step 250 so the top rung still clears 2:1 against
 *    white.
 *  - The status colours are reserved for state and are never spent on a series.
 *
 * Three categorical slots sit under 3:1 against white, so the relief rule
 * applies: every chart that uses them ships visible labels or a table beside it.
 * Nothing here asks the reader to match a colour alone.
 */
export const SERIES = ["#0020f5", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"] as const;

/** Ordinal blue, light → dark. Eight steps for the eight funnel rungs. */
const RAMP: readonly string[] = ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95"] as const;

const POS = "#079455";
const WARN = "#b54708";
const CRIT = "#d92d20";
const TRACK = "var(--color-line-soft)";

export const seriesColor = (i: number): string => SERIES[i % SERIES.length] ?? SERIES[0];

/* ------------------------------------------------------------------ chrome */

export function Panel({
  title,
  desc,
  children,
  wide,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`rounded-2xl border border-[var(--color-line)] bg-surface p-5 shadow-[var(--shadow-xs)] ${wide ? "lg:col-span-2" : ""}`}>
      <h3 className="text-[14.5px] font-bold tracking-tight">{title}</h3>
      {desc && <p className="mb-4 mt-0.5 text-[12.5px] text-muted">{desc}</p>}
      {!desc && <div className="mb-4" />}
      {children}
    </section>
  );
}

export function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-[19px] font-bold tracking-tight">{title}</h2>
      {note && <span className="text-[12.5px] text-muted">{note}</span>}
    </div>
  );
}

export function Empty({ what = "No data in this window." }: { what?: string }) {
  return <p className="py-8 text-center text-[13px] text-muted">{what}</p>;
}

export function Footnote({ children }: { children: ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-muted">{children}</p>;
}

/* --------------------------------------------------------------- stat tile */

const compact = (v: number) =>
  Math.abs(v) >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : Math.abs(v) >= 10_000
      ? `${(v / 1000).toFixed(1).replace(/\.0$/, "")}K`
      : v.toLocaleString("en-US");

export function Stat({
  label,
  value,
  sub,
  delta,
  deltaUnit = "%",
  upIsGood = true,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  /** Signed change against the prior period; null when there is nothing to compare to. */
  delta?: number | null;
  deltaUnit?: "%" | " pts";
  upIsGood?: boolean;
  tone?: "pos" | "warn" | "crit";
}) {
  const shown = typeof value === "number" ? compact(value) : value;
  const good = delta == null ? null : delta === 0 ? null : delta > 0 === upIsGood;
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-surface p-4 shadow-[var(--shadow-xs)]">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div
        className="mt-1 text-[26px] font-bold tracking-tight"
        style={{ color: tone === "pos" ? POS : tone === "warn" ? WARN : tone === "crit" ? CRIT : "var(--color-ink)" }}
      >
        {shown}
      </div>
      {delta != null && (
        <div className="mt-0.5 text-[12px] font-medium" style={{ color: good == null ? "var(--color-muted)" : good ? POS : CRIT }}>
          {delta > 0 ? "+" : ""}
          {delta}
          {deltaUnit} vs prior period
        </div>
      )}
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- bar list */

export interface BarDatum {
  label: string;
  value: number;
  /** Optional denominator — renders as "value / of" at the tip. */
  of?: number;
  color?: string;
  /** The same measure one period earlier, drawn as a thin bar beneath. */
  prior?: number;
  /** Shown after the value, e.g. a loss percentage. */
  note?: string;
  noteTone?: "pos" | "crit" | "muted";
}

/**
 * Horizontal bars — the default for comparing magnitudes across named things,
 * because the names get a full line of reading width instead of being rotated
 * under a column.
 *
 * Every bar carries its value at the tip, so the chart never depends on a reader
 * measuring a length against a gridline, and the low-contrast categorical slots
 * stay legible.
 */
export function BarList({ data, color, labelWidth = "w-44" }: { data: BarDatum[]; color?: string; labelWidth?: string }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.prior ?? 0)));
  if (!data.length) return <Empty />;
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className={`${labelWidth} shrink-0 truncate text-[12.5px] text-ink-2`} title={d.label}>
            {d.label}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="block h-2.5 w-full overflow-hidden rounded-[2px]" style={{ background: TRACK }}>
              <span
                className="block h-full rounded-r-[4px]"
                style={{ width: `${Math.max(1.5, (d.value / max) * 100)}%`, background: d.color ?? color ?? SERIES[0] }}
              />
            </span>
            {d.prior != null && (
              <span className="block h-[3px] w-full overflow-hidden rounded-[2px]">
                <span
                  className="block h-full rounded-r-[2px]"
                  style={{ width: `${Math.max(0.5, (d.prior / max) * 100)}%`, background: "var(--color-line)" }}
                />
              </span>
            )}
          </span>
          <span className="shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-ink">
            {d.value.toLocaleString("en-US")}
            {d.of != null && <span className="font-normal text-muted"> / {d.of.toLocaleString("en-US")}</span>}
          </span>
          {d.note && (
            <span
              className="w-14 shrink-0 text-right text-[12px] font-semibold tabular-nums"
              style={{ color: d.noteTone === "crit" ? CRIT : d.noteTone === "pos" ? POS : "var(--color-muted)" }}
            >
              {d.note}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** A legend is always present for two or more series — identity is never colour alone. */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-line-soft)] pt-3">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- stacked columns */

/**
 * One column per day, stacked by series.
 *
 * The 2px gap between segments is the surface showing through, which is what
 * separates neighbouring colours — a stroke around each segment would add ink
 * that is not data. Columns cap at 24px so a quiet fortnight does not render as
 * eight fat slabs.
 */
export function StackedDays({
  days,
  keys,
  label,
  height = 170,
}: {
  days: { day: string; byJourney: Record<string, number>; total: number }[];
  keys: string[];
  label: (k: string) => string;
  height?: number;
}) {
  if (!days.length) return <Empty />;
  const max = Math.max(1, ...days.map((d) => d.total));
  // Only ever label the ends and the peak — a number on every column is noise.
  const peak = days.reduce((best, d, i) => (d.total > (days[best]?.total ?? 0) ? i : best), 0);
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {days.map((d, di) => (
          <div key={`${d.day}-${di}`} className="group relative flex min-w-0 flex-1 flex-col justify-end" style={{ height }}>
            <div className="mx-auto flex w-full max-w-[24px] flex-col-reverse gap-[2px]" style={{ height: `${(d.total / max) * 100}%` }}>
              {keys.map((k, ki) => {
                const v = d.byJourney[k] ?? 0;
                if (!v) return null;
                return (
                  <span
                    key={k}
                    className="block w-full first:rounded-b-[2px] last:rounded-t-[4px]"
                    style={{ height: `${(v / d.total) * 100}%`, background: seriesColor(ki), minHeight: 2 }}
                  />
                );
              })}
            </div>
            {/* Hover layer: the per-day breakdown the stacked segments cannot label. */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max -translate-x-1/2 rounded-lg border border-[var(--color-line)] bg-surface px-2.5 py-2 shadow-[var(--shadow-md)] group-hover:block">
              <div className="text-[11.5px] font-semibold text-ink">{d.day}</div>
              {keys.map((k, ki) =>
                d.byJourney[k] ? (
                  <div key={k} className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: seriesColor(ki) }} />
                    <span className="truncate">{label(k)}</span>
                    <span className="ml-auto pl-3 font-semibold tabular-nums">{d.byJourney[k]}</span>
                  </div>
                ) : null
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-muted">
        <span>{days[0]?.day}</span>
        <span>
          peak {days[peak]?.day} · {days[peak]?.total}
        </span>
        <span>{days[days.length - 1]?.day}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ funnel */

/**
 * Where customers drop off.
 *
 * Each rung is a share of the WIDEST rung, so the shape of the loss is visible
 * at a glance; the number beside it is the loss against the rung directly above,
 * and the worst one is the only thing on the chart wearing a status colour.
 * The thin bar underneath is the same rung one period earlier.
 */
export function Funnel({ steps }: { steps: { step: string; note: string; now: number; prior: number; loss: number | null }[] }) {
  if (!steps.length) return <Empty />;
  const max = Math.max(1, ...steps.map((s) => Math.max(s.now, s.prior)));
  const worst = steps.reduce<number | null>((w, s, i) => (s.loss != null && (w == null || (steps[w]?.loss ?? 0) > s.loss) ? i : w), null);
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s, i) => (
        <div key={s.step} className="group flex items-center gap-3">
          <span className="w-40 shrink-0 text-[12.5px] text-ink-2" title={s.note}>
            {s.step}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="block h-3 w-full">
              <span
                className="block h-full rounded-r-[4px]"
                style={{ width: `${Math.max(1.5, (s.now / max) * 100)}%`, background: i === worst ? CRIT : RAMP[i % RAMP.length] }}
              />
            </span>
            <span className="block h-[3px] w-full">
              <span className="block h-full rounded-r-[2px]" style={{ width: `${Math.max(0.5, (s.prior / max) * 100)}%`, background: "var(--color-line)" }} />
            </span>
          </span>
          <span className="w-16 shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-ink">{s.now.toLocaleString("en-US")}</span>
          <span
            className="w-16 shrink-0 text-right text-[12px] font-semibold tabular-nums"
            style={{ color: s.loss == null ? "var(--color-muted)" : i === worst ? CRIT : "var(--color-muted)" }}
          >
            {s.loss == null ? "—" : `${s.loss}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- table */

export function Table({ head, rows }: { head: string[]; rows: (string | number | ReactNode)[][] }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-[var(--color-line)]">
            {head.map((h, i) => (
              <th key={h} className={`px-1 pb-2 font-medium text-muted ${i === 0 ? "text-left" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-[var(--color-line-soft)] last:border-0">
              {r.map((c, ci) => (
                <td key={ci} className={`px-1 py-2 ${ci === 0 ? "text-left text-ink-2" : "text-right font-semibold tabular-nums text-ink"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
