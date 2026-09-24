"use client";

/**
 * Integration health — is every service behind these agents answering?
 *
 * Asked for on 24 September: somewhere an administrator can see which
 * integration is down, rather than learning it from a customer who could not
 * sign in.
 *
 * Every probe behind /api/admin/health is read-only, so this page is safe to
 * refresh as often as anyone likes — nothing here charges a card, sends an
 * email or files a case. It is never cached either: a health page showing a
 * minute-old answer is not a health page.
 *
 * Grouped by agent rather than by service, because the question an
 * administrator actually has is "is Emirates Post working" and not "is every
 * payment gateway working".
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, MinusCircle } from "lucide-react";

type State = "ok" | "degraded" | "down" | "not_configured";

interface Check {
  agent: string | null;
  name: string;
  purpose: string;
  state: State;
  detail: string;
  ms: number | null;
}

interface Report {
  checkedAt: string;
  environment: string;
  checks: Check[];
  summary: { ok: number; degraded: number; down: number; notConfigured: number };
}

/**
 * Four states, four meanings, and the amber one earns its place: production
 * NXN deliberately points at Emirates Post's staging backend, and a red "down"
 * for something working as configured would train people to ignore the page.
 */
const LOOK: Record<State, { label: string; icon: typeof CheckCircle2; dot: string; text: string; ring: string }> = {
  ok: { label: "Working", icon: CheckCircle2, dot: "bg-emerald-500", text: "text-emerald-700", ring: "ring-emerald-200" },
  degraded: { label: "Check this", icon: AlertTriangle, dot: "bg-amber-500", text: "text-amber-700", ring: "ring-amber-200" },
  down: { label: "Not working", icon: XCircle, dot: "bg-red-500", text: "text-red-700", ring: "ring-red-200" },
  not_configured: { label: "Not set up", icon: MinusCircle, dot: "bg-slate-400", text: "text-slate-600", ring: "ring-slate-200" },
};

const ORDER: State[] = ["down", "degraded", "not_configured", "ok"];

export default function HealthPage() {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);

  const load = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`the check could not be run (HTTP ${res.status})`);
      setData((await res.json()) as Report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const agents = data ? [...new Set(data.checks.map((c) => c.agent ?? "Platform"))] : [];
  const worst: State | null = data
    ? (ORDER.find((s) => data.checks.some((c) => c.state === s)) ?? "ok")
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">Health</h1>
          <p className="mt-1 text-[13px] text-muted">
            Every integration behind the agents, checked live. Nothing here is cached, and no check writes anything.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-[13px] font-medium text-ink shadow-sm transition hover:bg-black/[0.03] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
          {running ? "Checking…" : "Check again"}
        </button>
      </div>

      {data && (
        <div className="mt-5 flex flex-wrap items-center gap-2 text-[12px]">
          {(["down", "degraded", "not_configured", "ok"] as State[]).map((s) => {
            const n =
              s === "ok" ? data.summary.ok : s === "degraded" ? data.summary.degraded : s === "down" ? data.summary.down : data.summary.notConfigured;
            if (!n) return null;
            return (
              <span key={s} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ${LOOK[s].ring} ${LOOK[s].text} bg-white`}>
                <span className={`h-1.5 w-1.5 rounded-full ${LOOK[s].dot}`} />
                {n} {LOOK[s].label.toLowerCase()}
              </span>
            );
          })}
          <span className="ml-auto text-muted">
            {data.environment} · checked {new Date(data.checkedAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai" })} UAE time
          </span>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{error}</div>
      )}

      {!data && !error && (
        <div className="mt-6 rounded-2xl border border-black/10 bg-white px-4 py-8 text-center text-[13px] text-muted">
          Asking every service whether it is answering…
        </div>
      )}

      {data &&
        agents.map((agent) => {
          const rows = data.checks
            .filter((c) => (c.agent ?? "Platform") === agent)
            .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state));
          return (
            <section key={agent} className="mt-7">
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">{agent}</h2>
              <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
                {rows.map((c, i) => {
                  const look = LOOK[c.state];
                  const Icon = look.icon;
                  return (
                    <div
                      key={`${c.name}-${i}`}
                      className={`flex items-start gap-3 px-4 py-3.5 ${i ? "border-t border-black/[0.06]" : ""}`}
                    >
                      <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${look.text}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[14px] font-medium text-ink">{c.name}</span>
                          <span className="text-[12px] text-muted">{c.purpose}</span>
                        </div>
                        {/* The detail is the whole point: "down" with no reason is
                            a pager, not a diagnosis. */}
                        <p className={`mt-0.5 text-[12.5px] ${c.state === "ok" ? "text-muted" : look.text}`}>{c.detail}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`text-[12px] font-medium ${look.text}`}>{look.label}</div>
                        {c.ms !== null && <div className="text-[11px] text-muted">{c.ms} ms</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

      {data && worst === "ok" && (
        <p className="mt-6 text-center text-[12.5px] text-muted">Everything is answering.</p>
      )}
    </div>
  );
}
