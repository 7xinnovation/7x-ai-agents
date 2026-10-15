"use client";

import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/** A task as /api/developers/tasks returns it. `journey` and `persona` come from free-form metadata. */
export interface TaskRow {
  id: string;
  appId: string;
  agentSlug: string;
  contextId: string;
  state: string;
  awaiting: string | null;
  journey: unknown;
  persona: unknown;
  lastText: string;
  createdAt: string;
  updatedAt: string;
}

/** One call on the doorway, as /api/developers/logs returns it. */
export interface RequestRow {
  id: string;
  appId: string | null;
  agentSlug: string | null;
  taskId: string | null;
  method: string;
  binding: string;
  ok: boolean;
  errorCode: number | null;
  httpStatus: number;
  latencyMs: number;
  createdAt: string;
}

type Tab = "tasks" | "requests";

const TASKS_LIMIT = 100;
const REQUESTS_LIMIT = 200;

const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const clock = new Intl.DateTimeFormat("en-GB", { timeStyle: "medium" });

/** The names behind the codes, so a log line reads without the spec open. */
const A2A_ERRORS: Record<number, string> = {
  [-32700]: "JSONParseError",
  [-32600]: "InvalidRequestError",
  [-32601]: "MethodNotFoundError",
  [-32602]: "InvalidParamsError",
  [-32603]: "InternalError",
  [-32001]: "TaskNotFoundError",
  [-32002]: "TaskNotCancelableError",
  [-32003]: "PushNotificationNotSupportedError",
  [-32004]: "UnsupportedOperationError",
  [-32005]: "ContentTypeNotSupportedError",
  [-32006]: "InvalidAgentResponseError",
  [-32007]: "ExtendedAgentCardNotConfiguredError",
  [-32008]: "ExtensionSupportRequiredError",
  [-32009]: "VersionNotSupportedError",
  [-32010]: "UnauthenticatedError",
  [-32011]: "PermissionDeniedError",
  [-32012]: "RateLimitedError",
};

/** "TASK_STATE_INPUT_REQUIRED" → "Input required". */
const stateLabel = (s: string) => {
  const w = s.replace(/^TASK_STATE_/, "").toLowerCase().replace(/_/g, " ");
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : s;
};

function relative(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return fmt.format(new Date(iso));
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

export function ActivityClient({ initialTasks, initialRequests }: { initialTasks: TaskRow[]; initialRequests: RequestRow[] }) {
  const [tab, setTab] = useState<Tab>("tasks");
  const [tasks, setTasks] = useState(initialTasks);
  const [requests, setRequests] = useState(initialRequests);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [live, setLive] = useState("");

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const announce = (text: string) => {
    setLive("");
    setTimeout(() => setLive(text), 10);
  };

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const [t, r] = await Promise.all([
        fetch(`/api/developers/tasks?limit=${TASKS_LIMIT}`, { cache: "no-store" }),
        fetch(`/api/developers/logs?limit=${REQUESTS_LIMIT}`, { cache: "no-store" }),
      ]);
      if (t.status === 401 || r.status === 401) {
        window.location.assign(`/developers/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!t.ok || !r.ok) throw new Error(`HTTP ${t.ok ? r.status : t.status}`);
      const tb = (await t.json()) as { tasks: TaskRow[] };
      const rb = (await r.json()) as { requests: RequestRow[] };
      setTasks(tb.tasks);
      setRequests(rb.requests);
      setRefreshedAt(new Date());
      setNow(Date.now());
      announce(`Refreshed: ${tb.tasks.length} tasks, ${rb.requests.length} requests.`);
    } catch (e) {
      setError(`The activity could not be refreshed (${(e as Error).message}).`);
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "tasks", label: "Tasks", count: tasks.length },
    { id: "requests", label: "Requests", count: requests.length },
  ];

  return (
    <div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {live}
      </span>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold text-ink">Activity</h1>
          <p className="mt-1 max-w-[62ch] text-[14px] text-muted">
            The tasks your applications created and every call they made on the doorway. The most recent {TASKS_LIMIT} tasks and {REQUESTS_LIMIT}{" "}
            requests.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {refreshedAt ? (
            <span className="text-[12.5px] text-muted" suppressHydrationWarning>
              Refreshed {clock.format(refreshedAt)}
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw size={14} strokeWidth={2} className={cn(busy && "animate-spin motion-reduce:animate-none")} />
            {busy ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div aria-live="polite" aria-atomic="true">
        {error ? (
          <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] text-rose-800">
            {error}
          </div>
        ) : null}
      </div>

      <div role="tablist" aria-label="Activity sections" className="mt-6 inline-flex rounded-lg border border-[var(--color-line)] bg-surface p-1 ">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next: Tab = t.id === "tasks" ? "requests" : "tasks";
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-md px-3 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]",
              tab === t.id ? "bg-[color-mix(in_srgb,var(--color-brand)_8%,white)] text-brand" : "text-ink-2 hover:bg-[var(--color-line-soft)] hover:text-ink"
            )}
          >
            {t.label}
            <span className={cn("mono rounded-full px-1.5 text-[11px] tabular-nums", tab === t.id ? "bg-white text-brand" : "bg-[var(--color-line-soft)] text-muted")}>{t.count}</span>
          </button>
        ))}
      </div>

      <div id="panel-tasks" role="tabpanel" aria-labelledby="tab-tasks" hidden={tab !== "tasks"} className="mt-4">
        <TasksTable rows={tasks} now={now} onCopied={announce} />
      </div>
      <div id="panel-requests" role="tabpanel" aria-labelledby="tab-requests" hidden={tab !== "requests"} className="mt-4">
        <RequestsTable rows={requests} now={now} onCopied={announce} />
      </div>
    </div>
  );
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

function TasksTable({ rows, now, onCopied }: { rows: TaskRow[]; now: number | null; onCopied: (t: string) => void }) {
  if (!rows.length) {
    return <Empty title="No tasks yet" text="A task appears here the first time one of your applications sends a message to the agent." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-line)] bg-surface ">
      <table className="w-full min-w-[980px] text-left text-[13px]">
        <thead className="border-b border-[var(--color-line)] bg-[var(--color-canvas)] text-[12.5px] font-medium text-muted">
          <tr>
            <Th>State</Th>
            <Th>Agent</Th>
            <Th>Journey</Th>
            <Th>Persona</Th>
            <Th className="w-[34%]">Last agent text</Th>
            <Th>Awaiting</Th>
            <Th>Updated</Th>
            <Th>Task ID</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-[var(--color-line-soft)] align-top last:border-0">
              <Td>
                <span className="dev-state" data-state={t.state}>
                  {stateLabel(t.state)}
                </span>
              </Td>
              <Td className="mono text-[12.5px] text-ink-2">{t.agentSlug}</Td>
              <Td className="text-ink-2">{str(t.journey) ?? <Dash />}</Td>
              <Td className="mono text-[12.5px] text-ink-2">{str(t.persona) ?? <Dash />}</Td>
              <Td>
                {t.lastText ? (
                  <span className="line-clamp-2 max-w-[48ch] text-ink-2" title={t.lastText}>
                    {t.lastText}
                  </span>
                ) : (
                  <Dash />
                )}
              </Td>
              <Td>{t.awaiting ? <Badge tone="draft">{t.awaiting}</Badge> : <Dash />}</Td>
              <Td className="whitespace-nowrap text-ink-2">
                <Time iso={t.updatedAt} now={now} />
              </Td>
              <Td>
                <Id value={t.id} label="task ID" onCopied={onCopied} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Requests ────────────────────────────────────────────────────────────────

function RequestsTable({ rows, now, onCopied }: { rows: RequestRow[]; now: number | null; onCopied: (t: string) => void }) {
  if (!rows.length) {
    return <Empty title="No requests yet" text="Every call made with your credentials is listed here: the token exchange, each message and each task read." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-line)] bg-surface ">
      <table className="w-full min-w-[860px] text-left text-[13px]">
        <thead className="border-b border-[var(--color-line)] bg-[var(--color-canvas)] text-[12.5px] font-medium text-muted">
          <tr>
            <Th>Time</Th>
            <Th>Method</Th>
            <Th>Binding</Th>
            <Th>Status</Th>
            <Th>Result</Th>
            <Th className="text-right">Latency</Th>
            <Th>Task ID</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-[var(--color-line-soft)] last:border-0">
              <Td className="whitespace-nowrap text-ink-2">
                <Time iso={r.createdAt} now={now} />
              </Td>
              <Td className="mono text-[12.5px] text-ink">{r.method}</Td>
              <Td className="mono text-[12.5px] text-ink-2">{r.binding}</Td>
              <Td className={cn("mono tabular-nums", r.httpStatus >= 400 ? "text-[#b42318]" : "text-ink-2")}>{r.httpStatus}</Td>
              <Td>
                {r.ok ? (
                  <Badge tone="live" dot>OK</Badge>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Badge tone="muted" dot className="border-[#fecdca] bg-[#fef3f2] text-[#b42318] [&>span]:bg-[#f04438]">
                      Error
                    </Badge>
                    {r.errorCode !== null ? (
                      <span className="mono text-[12px] text-ink-2" title={A2A_ERRORS[r.errorCode] ?? "Implementation-defined error"}>
                        {r.errorCode}
                        {A2A_ERRORS[r.errorCode] ? <span className="text-muted"> {A2A_ERRORS[r.errorCode]}</span> : null}
                      </span>
                    ) : null}
                  </span>
                )}
              </Td>
              <Td className="mono whitespace-nowrap text-right tabular-nums text-ink-2">{r.latencyMs} ms</Td>
              <Td>{r.taskId ? <Id value={r.taskId} label="task ID" onCopied={onCopied} /> : <Dash />}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return <th className={cn("px-4 py-2.5 font-semibold first:pl-5 last:pr-5", className)}>{children}</th>;
}
function Td({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn("px-4 py-3 first:pl-5 last:pr-5", className)}>{children}</td>;
}
const Dash = () => <span className="text-muted">-</span>;

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-surface px-5 py-8 ">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <p className="mt-1 max-w-[60ch] text-[13.5px] leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}

/** Relative when `now` is known (after mount), absolute otherwise; always absolute in the title. */
function Time({ iso, now }: { iso: string; now: number | null }) {
  const abs = fmt.format(new Date(iso));
  return (
    <time dateTime={iso} title={abs} suppressHydrationWarning>
      {now === null ? abs : relative(iso, now)}
    </time>
  );
}

/** A UUID shortened for the row, whole in the title and on the clipboard. */
function Id({ value, label, onCopied }: { value: string; label: string; onCopied: (t: string) => void }) {
  const [done, setDone] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <code className="mono text-[12px] text-ink-2" title={value}>
        {value.slice(0, 8)}…
      </code>
      <button
        type="button"
        aria-label={done ? `${label} copied` : `Copy ${label} ${value}`}
        title={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            onCopied(`Copied ${label}.`);
            setTimeout(() => setDone(false), 1400);
          } catch {
            onCopied(`Could not copy ${label}; select it and copy by hand.`);
          }
        }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted outline-none transition-colors hover:bg-[var(--color-line-soft)] hover:text-ink focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
      >
        {done ? <Check size={12} strokeWidth={2.4} className="text-[#067647]" /> : <Copy size={12} strokeWidth={2} />}
      </button>
    </span>
  );
}
