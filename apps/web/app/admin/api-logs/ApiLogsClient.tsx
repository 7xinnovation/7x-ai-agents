"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

export interface CallRow {
  id: string;
  integration: string | null;
  environment: string | null;
  tool: string | null;
  method: string;
  path: string;
  url: string;
  status: number | null;
  ok: boolean;
  durationMs: number;
  error: string | null;
  requestBody: string | null;
  responseBody: string | null;
  createdAt: string;
  conversationId: string | null;
}
export interface EndpointRow {
  method: string;
  path: string;
  calls: number;
  errors: number;
  avgMs: number;
  lastAt: string | null;
}
export interface Stats {
  total: number;
  errors: number;
  avgMs: number;
}

const WINDOWS = [
  { hours: 1, label: "Last hour" },
  { hours: 24, label: "Last 24 hours" },
  { hours: 24 * 7, label: "Last 7 days" },
  { hours: 24 * 30, label: "Last 30 days" },
];

const num = (n: number) => n.toLocaleString("en-US");

/**
 * The live half of the API Logs page.
 *
 * The filters live in the URL so a view can be linked to — "EPGL, errors only,
 * last 7 days" is a link somebody can paste into a bug report — and the refresh
 * re-reads the same filter through /api/admin/api-logs without a navigation.
 */
export function ApiLogsClient({
  agent,
  initial,
  outcome,
  q,
  hours,
}: {
  agent: string;
  initial: { stats: Stats; rows: CallRow[]; endpoints: EndpointRow[] };
  outcome: "all" | "ok" | "error";
  q: string;
  hours: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [search, setSearch] = useState(q);
  const [open, setOpen] = useState<string | null>(null);
  // The server sent this set; a refresh replaces it. Without this an auto-refresh
  // started under one filter would keep answering after the filter changed.
  const filterKey = `${agent}|${outcome}|${q}|${hours}`;
  const lastKey = useRef(filterKey);
  useEffect(() => {
    if (lastKey.current !== filterKey) {
      lastKey.current = filterKey;
      setData(initial);
    }
  }, [filterKey, initial]);

  const setParam = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.push(`/admin/api-logs${next.toString() ? `?${next}` : ""}`);
    },
    [params, router]
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      if (agent) qs.set("agent", agent);
      if (outcome !== "all") qs.set("outcome", outcome);
      if (q) qs.set("q", q);
      qs.set("hours", String(hours));
      const res = await fetch(`/api/admin/api-logs?${qs}`, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as typeof initial);
    } finally {
      setBusy(false);
    }
  }, [agent, outcome, q, hours, initial]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [auto, refresh]);

  const success = Math.max(0, data.stats.total - data.stats.errors);
  const failing = useMemo(() => data.endpoints.filter((e) => e.errors > 0), [data.endpoints]);

  return (
    <>
      <div className="sa-stats sa-stats-3">
        <div className="sa-stat">
          <span className="sa-stat-label">Total calls</span>
          <span className="sa-stat-value">{num(data.stats.total)}</span>
          <span className="sa-stat-hint">{WINDOWS.find((w) => w.hours === hours)?.label.toLowerCase() ?? `last ${hours}h`}</span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Errors</span>
          <span className="sa-stat-value" style={{ color: data.stats.errors ? "var(--danger, #d92d20)" : undefined }}>
            {num(data.stats.errors)}
          </span>
          <span className="sa-stat-hint">
            {data.stats.total ? `${((data.stats.errors / data.stats.total) * 100).toFixed(1)}% of calls` : "nothing yet"}
          </span>
        </div>
        <div className="sa-stat">
          <span className="sa-stat-label">Avg response time</span>
          <span className="sa-stat-value">{num(data.stats.avgMs)}ms</span>
          <span className="sa-stat-hint">across every call in the window</span>
        </div>
      </div>

      <div className="sa-log-bar">
        <div className="sa-tabs sa-log-tabs">
          {([
            ["all", `All (${num(data.stats.total)})`],
            ["ok", `Success (${num(success)})`],
            ["error", `Errors (${num(data.stats.errors)})`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`sa-tab${outcome === id ? " on" : ""}`}
              onClick={() => setParam({ outcome: id === "all" ? undefined : id })}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="sa-log-actions"
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ q: search.trim() || undefined });
          }}
        >
          <input
            className="sa-log-search"
            placeholder="Search endpoint, tool or body…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="sa-log-window"
            value={String(hours)}
            onChange={(e) => setParam({ hours: e.target.value })}
            aria-label="Time window"
          >
            {WINDOWS.map((w) => (
              <option key={w.hours} value={w.hours}>{w.label}</option>
            ))}
          </select>
          <label className="sa-log-auto">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto-refresh
          </label>
          <button type="button" className="sa-log-refresh" onClick={refresh} disabled={busy}>
            <RefreshCw className={busy ? "spin" : ""} size={14} /> Refresh
          </button>
        </form>
      </div>

      {failing.length ? (
        <section className="sa-panel sa-log-rollup">
          <div className="sa-panel-head">
            <h2>Endpoints with failures</h2>
            <span className="sa-muted">{failing.length}</span>
          </div>
          <div className="sa-table">
            {failing.map((e) => (
              <div className="sa-tr sa-log-rollup-tr" key={`${e.method} ${e.path}`}>
                <span className="sa-log-path">
                  <b className="sa-log-method">{e.method}</b> {e.path}
                </span>
                <span>{num(e.calls)} calls</span>
                <span className="sa-log-bad">{num(e.errors)} failed</span>
                <span>{num(e.avgMs)}ms avg</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="sa-panel">
        <div className="sa-panel-head">
          <h2>Calls</h2>
          <span className="sa-muted">{data.rows.length === 100 ? "latest 100" : num(data.rows.length)}</span>
        </div>
        {data.rows.length === 0 ? (
          <p className="sa-empty-line">
            Nothing recorded in this window. Calls appear here as soon as an agent uses an integration.
          </p>
        ) : null}
        <div className="sa-log-list">
          {data.rows.map((r) => {
            const isOpen = open === r.id;
            return (
              <div className={`sa-log-row${r.ok ? "" : " bad"}`} key={r.id}>
                <button type="button" className="sa-log-head" onClick={() => setOpen(isOpen ? null : r.id)}>
                  <span className={`sa-log-dot${r.ok ? " ok" : " bad"}`} />
                  <b className="sa-log-method">{r.method}</b>
                  <span className="sa-log-path" title={r.path}>{r.path}</span>
                  <span className={`sa-log-status${r.ok ? "" : " bad"}`}>{r.status ?? (r.error ? "ERR" : "—")}</span>
                  <span className="sa-log-ms">{num(r.durationMs)}ms</span>
                  <span className="sa-log-when">{new Date(r.createdAt).toLocaleString("en-GB")}</span>
                  {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                {isOpen ? (
                  <div className="sa-log-detail">
                    <dl>
                      <dt>Integration</dt>
                      <dd>{r.integration ?? "—"}{r.environment ? ` · ${r.environment}` : ""}</dd>
                      <dt>Tool</dt>
                      <dd>{r.tool ?? "—"}</dd>
                      <dt>URL</dt>
                      <dd className="sa-log-url">{r.url}</dd>
                      {r.conversationId ? (
                        <>
                          <dt>Conversation</dt>
                          <dd>
                            <a href={`/admin/conversations/${r.conversationId}`}>{r.conversationId.slice(0, 8)}…</a>
                          </dd>
                        </>
                      ) : null}
                      {r.error ? (
                        <>
                          <dt>Error</dt>
                          <dd className="sa-log-bad">{r.error}</dd>
                        </>
                      ) : null}
                    </dl>
                    {r.requestBody ? (
                      <>
                        <h4>Request</h4>
                        <pre>{pretty(r.requestBody)}</pre>
                      </>
                    ) : null}
                    {r.responseBody ? (
                      <>
                        <h4>Response</h4>
                        <pre>{pretty(r.responseBody)}</pre>
                      </>
                    ) : null}
                    <p className="sa-log-note">
                      Personal data is redacted and credentials are never stored, so a body here can differ from the one on the wire.
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

/** JSON indented when it is JSON; left exactly as it came when it is not. */
function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
