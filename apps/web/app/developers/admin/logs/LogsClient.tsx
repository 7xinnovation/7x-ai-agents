"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { AdminHeader } from "@/components/developers/admin/AdminNav";
import { TaskDrawer } from "@/components/developers/admin/TaskDrawer";
import { Time, adminApi } from "@/components/developers/admin/ui";
import { Dash, Empty, Json, TableFrame, Tag, Td, Th } from "@/components/developers/admin/table";
import { btnPrimary, btnSecondary, inputCls, rowCls, theadCls } from "@/components/developers/admin/styles";
import { A2A_ERRORS, TASK_STATES, actionLabel, byLabel, eventDetails, stateLabel } from "@/components/developers/admin/labels";
import type { EventRow, RequestRow, TaskRow } from "@/components/developers/admin/types";
import { cn } from "@/lib/utils";

export type LogsTab = "requests" | "tasks" | "events";
export interface LogsFilters {
  accountId?: string;
  appId?: string;
  outcome?: string;
  state?: string;
  scope?: string;
  q?: string;
}
export type LogsInitial =
  | { tab: "requests"; rows: RequestRow[]; nextCursor: string | null }
  | { tab: "tasks"; rows: TaskRow[]; nextCursor: string | null }
  | { tab: "events"; rows: EventRow[]; nextCursor: string | null };

type Option = { id: string; label: string };
type AppOption = Option & { accountId: string };
type Page<T> = { key: string; rows: T[]; nextCursor: string | null };
type Pages = { requests?: Page<RequestRow>; tasks?: Page<TaskRow>; events?: Page<EventRow> };

const LIMIT: Record<LogsTab, number> = { requests: 100, tasks: 50, events: 100 };
const TABS: { id: LogsTab; label: string }[] = [
  { id: "requests", label: "Requests" },
  { id: "tasks", label: "Tasks" },
  { id: "events", label: "Events" },
];
const SCOPES: { id: string; label: string }[] = [
  { id: "portal", label: "Portal" },
  { id: "sandbox", label: "Sandbox agent" },
  { id: "all", label: "Everything" },
];

/** The query a tab sends: only the filters that tab understands. */
function paramsFor(tab: LogsTab, f: LogsFilters): URLSearchParams {
  const p = new URLSearchParams();
  const put = (k: keyof LogsFilters) => {
    const v = f[k];
    if (v) p.set(k, v);
  };
  if (tab === "requests") (["accountId", "appId", "outcome"] as const).forEach(put);
  if (tab === "tasks") (["accountId", "appId", "state"] as const).forEach(put);
  if (tab === "events") {
    p.set("scope", f.scope || "portal");
    put("q");
  }
  return p;
}

export function LogsClient({
  initial,
  initialFilters,
  accounts,
  apps,
}: {
  initial: LogsInitial;
  initialFilters: LogsFilters;
  accounts: Option[];
  apps: AppOption[];
}) {
  const [tab, setTab] = useState<LogsTab>(initial.tab);
  const [filters, setFilters] = useState<LogsFilters>(initialFilters);
  const [pages, setPages] = useState<Pages>(() => ({
    [initial.tab]: { key: paramsFor(initial.tab, initialFilters).toString(), rows: initial.rows, nextCursor: initial.nextCursor },
  }));
  const [loading, setLoading] = useState<"replace" | "more" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [qDraft, setQDraft] = useState(initialFilters.q ?? "");
  const seq = useRef(0);

  const key = paramsFor(tab, filters).toString();
  const page = pages[tab];
  const current = page && page.key === key ? page : null;

  const load = useCallback(
    async (more: boolean) => {
      const my = ++seq.current;
      const params = paramsFor(tab, filters);
      const k = params.toString();
      const cursor = more ? pages[tab]?.nextCursor : null;
      if (cursor) params.set("cursor", cursor);
      params.set("limit", String(LIMIT[tab]));
      setLoading(more ? "more" : "replace");
      setError(null);
      const r = await adminApi<{ requests?: RequestRow[]; tasks?: TaskRow[]; events?: EventRow[]; nextCursor: string | null }>(`/api/developers/admin/${tab}?${params}`);
      if (my !== seq.current) return;
      setLoading(null);
      if (!r.ok) {
        setError(`The ${tab} could not be loaded (${r.error}).`);
        return;
      }
      const rows = (r.body[tab] ?? []) as never[];
      setPages((p) => {
        const before = more && p[tab]?.key === k ? (p[tab]!.rows as never[]) : [];
        return { ...p, [tab]: { key: k, rows: [...before, ...rows], nextCursor: r.body.nextCursor } };
      });
    },
    [tab, filters, pages]
  );

  // A tab whose page was loaded under other filters (or never) loads now.
  useEffect(() => {
    if (!current) void load(false);
  }, [tab, key]);

  // The URL follows the tab and the filters, so a view can be shared or reloaded.
  useEffect(() => {
    const u = new URLSearchParams();
    u.set("tab", tab);
    for (const [k, v] of Object.entries(filters)) if (v && !(k === "scope" && v === "portal")) u.set(k, v);
    window.history.replaceState(null, "", `${window.location.pathname}?${u}`);
  }, [tab, filters]);

  const set = (patch: Partial<LogsFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const closeDrawer = useCallback(() => setDrawer(null), []);

  const accountLabel = (id: string) => accounts.find((a) => a.id === id)?.label ?? id;
  const appLabel = (id: string) => apps.find((a) => a.id === id)?.label ?? id;
  const appChoices = filters.accountId ? apps.filter((a) => a.accountId === filters.accountId) : apps;

  const chips: { key: keyof LogsFilters; text: string }[] = [];
  if (tab !== "events") {
    if (filters.accountId) chips.push({ key: "accountId", text: `Account: ${accountLabel(filters.accountId)}` });
    if (filters.appId) chips.push({ key: "appId", text: `Application: ${appLabel(filters.appId)}` });
  }
  if (tab === "requests" && filters.outcome) chips.push({ key: "outcome", text: `Outcome: ${filters.outcome === "ok" ? "OK" : "Error"}` });
  if (tab === "tasks" && filters.state) chips.push({ key: "state", text: `State: ${stateLabel(filters.state)}` });
  if (tab === "events" && filters.q) chips.push({ key: "q", text: `Search: ${filters.q}` });

  return (
    <div>
      <AdminHeader title="Logs" subtitle="Every call on the A2A doorway, every task, and the audit trail of the portal and the sandbox agent." />

      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Log" className="inline-flex self-start border border-[var(--color-line)] bg-white">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              role="tab"
              id={`log-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="log-panel"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!.id;
                setTab(next);
                document.getElementById(`log-tab-${next}`)?.focus();
              }}
              className={cn(
                "h-9 px-4 text-[13.5px] outline-none transition-colors focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]",
                i > 0 && "border-l border-[var(--color-line)]",
                tab === t.id ? "bg-[#1330f0] font-medium text-white" : "text-ink-2 hover:bg-[var(--color-canvas)] hover:text-ink"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className={cn(btnSecondary, "self-start lg:self-auto")} onClick={() => void load(false)} disabled={loading !== null}>
          <RefreshCw size={14} strokeWidth={1.75} className={cn(loading === "replace" && "animate-spin motion-reduce:animate-none")} />
          Refresh
        </button>
      </div>

      {/* Filters for the current tab */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {tab !== "events" ? (
          <>
            <FilterSelect
              label="Account"
              value={filters.accountId ?? ""}
              onChange={(v) => set({ accountId: v || undefined, appId: v && filters.appId && apps.find((a) => a.id === filters.appId)?.accountId !== v ? undefined : filters.appId })}
              options={[{ id: "", label: "All accounts" }, ...accounts]}
            />
            <FilterSelect label="Application" value={filters.appId ?? ""} onChange={(v) => set({ appId: v || undefined })} options={[{ id: "", label: "All applications" }, ...appChoices]} />
          </>
        ) : null}
        {tab === "requests" ? (
          <FilterSelect
            label="Outcome"
            value={filters.outcome ?? ""}
            onChange={(v) => set({ outcome: v || undefined })}
            options={[
              { id: "", label: "All outcomes" },
              { id: "ok", label: "OK" },
              { id: "error", label: "Error" },
            ]}
          />
        ) : null}
        {tab === "tasks" ? (
          <FilterSelect label="State" value={filters.state ?? ""} onChange={(v) => set({ state: v || undefined })} options={[{ id: "", label: "All states" }, ...TASK_STATES.map((s) => ({ id: s, label: stateLabel(s) }))]} />
        ) : null}
        {tab === "events" ? (
          <>
            <fieldset>
              <legend className="mb-1.5 text-[12.5px] font-medium text-muted">Scope</legend>
              <div className="inline-flex border border-[#c9cfd6] bg-white">
                {SCOPES.map((s, i) => {
                  const on = (filters.scope || "portal") === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ scope: s.id })}
                      className={cn(
                        "h-9 px-3 text-[13px] outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]",
                        i > 0 && "border-l border-[#c9cfd6]",
                        on ? "bg-[var(--color-canvas)] font-medium text-ink" : "text-muted hover:text-ink"
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <form
              role="search"
              className="flex min-w-0 flex-1 items-end gap-2 sm:max-w-[420px]"
              onSubmit={(e) => {
                e.preventDefault();
                set({ q: qDraft.trim().slice(0, 100) || undefined });
              }}
            >
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-[12.5px] font-medium text-muted">Search actions and payloads</span>
                <input className={inputCls} value={qDraft} onChange={(e) => setQDraft(e.target.value)} maxLength={100} placeholder="e.g. an email, a client ID, payment" />
              </label>
              <button type="submit" className={cn(btnPrimary, "h-9")} aria-label="Search">
                <Search size={14} strokeWidth={1.75} />
                <span className="hidden sm:inline">Search</span>
              </button>
            </form>
          </>
        ) : null}
      </div>

      {chips.length ? (
        <ul className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.key} className="inline-flex max-w-full items-center gap-1 rounded-[3px] border border-[var(--color-line)] bg-white py-0.5 pl-2 pr-0.5 text-[12.5px] text-ink-2">
              <span className="truncate">{c.text}</span>
              <button
                type="button"
                aria-label={`Clear ${c.text}`}
                onClick={() => {
                  set({ [c.key]: undefined });
                  if (c.key === "q") setQDraft("");
                }}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-[2px] text-muted hover:bg-[var(--color-line-soft)] hover:text-ink"
              >
                <X size={12} strokeWidth={1.75} />
              </button>
            </li>
          ))}
          {chips.length > 1 ? (
            <li>
              <button
                type="button"
                className="text-[12.5px] font-medium text-[#1330f0] hover:underline"
                onClick={() => {
                  set(Object.fromEntries(chips.map((c) => [c.key, undefined])));
                  setQDraft("");
                }}
              >
                Clear all
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {tab === "events" && (filters.accountId || filters.appId) ? (
        <p className="mt-3 text-[12.5px] text-muted">Events are not filtered by account or application. Use the search box to find an email or a client ID.</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-[13.5px] text-[#b42318]">
          {error}
        </p>
      ) : null}

      <div id="log-panel" role="tabpanel" aria-labelledby={`log-tab-${tab}`} aria-busy={loading !== null} className="mt-4">
        {!current ? (
          <p className="border border-[var(--color-line)] bg-white px-5 py-8 text-[13.5px] text-muted" role="status">
            {error ? "Nothing to show." : "Loading…"}
          </p>
        ) : current.rows.length === 0 ? (
          <Empty
            text={
              tab === "requests"
                ? chips.length
                  ? "No requests match these filters."
                  : "No calls have reached the doorway yet."
                : tab === "tasks"
                  ? chips.length
                    ? "No tasks match these filters."
                    : "No application has created a task yet."
                  : filters.q
                    ? "No events match this search."
                    : "No events in this scope yet."
            }
          />
        ) : tab === "requests" ? (
          <RequestsTable rows={current.rows as RequestRow[]} onTask={setDrawer} />
        ) : tab === "tasks" ? (
          <TasksTable rows={current.rows as TaskRow[]} onTask={setDrawer} />
        ) : (
          <EventsTable rows={current.rows as EventRow[]} />
        )}

        {current?.nextCursor ? (
          <div className="mt-4 flex justify-center">
            <button type="button" className={btnSecondary} onClick={() => void load(true)} disabled={loading !== null}>
              {loading === "more" ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : current && current.rows.length ? (
          <p className="mt-3 text-center text-[12.5px] text-muted">
            {current.rows.length} {current.rows.length === 1 ? "row" : "rows"}, the end of the log.
          </p>
        ) : null}
      </div>

      <TaskDrawer taskId={drawer} onClose={closeDrawer} />
    </div>
  );
}

// ─── Filters ─────────────────────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Option[] }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-muted">{label}</span>
      <select className={cn(inputCls, "w-auto max-w-[280px] cursor-pointer pr-8")} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─── Requests ────────────────────────────────────────────────────────────────

function Who({ org, app }: { org: string | null; app: string | null }) {
  if (!org && !app) return <span className="text-muted">No application</span>;
  return (
    <>
      <span className="block text-ink">{org ?? "-"}</span>
      <span className="block text-[12px] text-muted">{app ?? "-"}</span>
    </>
  );
}

function TaskLink({ id, onTask }: { id: string; onTask: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTask(id);
      }}
      title={`Open task ${id}`}
      className="mono text-[12px] text-[#1330f0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
    >
      {id.slice(0, 8)}…
    </button>
  );
}

function RequestsTable({ rows, onTask }: { rows: RequestRow[]; onTask: (id: string) => void }) {
  return (
    <TableFrame minWidth={1040}>
      <thead className={theadCls}>
        <tr>
          <Th>Time</Th>
          <Th>Organisation / application</Th>
          <Th>Method</Th>
          <Th>Binding</Th>
          <Th>Status</Th>
          <Th>Result</Th>
          <Th className="text-right">Latency</Th>
          <Th>Task</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={cn(rowCls, "align-top")}>
            <Td className="whitespace-nowrap text-ink-2">
              <Time iso={r.createdAt} />
            </Td>
            <Td>
              <Who org={r.organization} app={r.appName} />
            </Td>
            <Td className="mono text-[12.5px] text-ink">{r.method}</Td>
            <Td className="mono text-[12.5px] text-ink-2">{r.binding}</Td>
            <Td className={cn("mono tabular-nums", r.httpStatus >= 400 ? "text-[#b42318]" : "text-ink-2")}>{r.httpStatus}</Td>
            <Td>
              {r.ok ? (
                <Tag tone="ok">OK</Tag>
              ) : (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <Tag tone="error">Error</Tag>
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
            <Td>{r.taskId ? <TaskLink id={r.taskId} onTask={onTask} /> : <Dash />}</Td>
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

function TasksTable({ rows, onTask }: { rows: TaskRow[]; onTask: (id: string) => void }) {
  return (
    <TableFrame minWidth={1180}>
      <thead className={theadCls}>
        <tr>
          <Th>State</Th>
          <Th>Organisation / application</Th>
          <Th>Agent</Th>
          <Th>Journey</Th>
          <Th>Persona</Th>
          <Th className="w-[30%]">Last agent text</Th>
          <Th className="text-right">Messages</Th>
          <Th>Artifacts</Th>
          <Th>Updated</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr
            key={t.id}
            tabIndex={0}
            aria-label={`Open task ${t.id}`}
            onClick={() => onTask(t.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTask(t.id);
              }
            }}
            className={cn(rowCls, "cursor-pointer align-top outline-none hover:bg-[var(--color-canvas)] focus-visible:bg-[var(--color-canvas)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]")}
          >
            <Td>
              <span className="dev-state" data-state={t.state}>
                {stateLabel(t.state)}
              </span>
            </Td>
            <Td>
              <Who org={t.organization} app={t.appName} />
            </Td>
            <Td className="mono text-[12.5px] text-ink-2">{t.agentSlug}</Td>
            <Td className="text-ink-2">{t.journey ?? <Dash />}</Td>
            <Td className="mono text-[12.5px] text-ink-2">{t.persona ?? <Dash />}</Td>
            <Td>
              {t.lastText ? (
                <span className="line-clamp-2 max-w-[52ch] text-ink-2" title={t.lastText.replace(/\*\*/g, "")}>
                  {t.lastText.replace(/\*\*/g, "")}
                </span>
              ) : (
                <Dash />
              )}
            </Td>
            <Td className="text-right tabular-nums text-ink-2">{t.messages}</Td>
            <Td>
              {t.artifacts.length ? (
                <span className="mono block max-w-[22ch] truncate text-[12px] text-ink-2" title={t.artifacts.join(", ")}>
                  {t.artifacts.join(", ")}
                </span>
              ) : (
                <Dash />
              )}
            </Td>
            <Td className="whitespace-nowrap text-ink-2">
              <Time iso={t.updatedAt} />
            </Td>
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}

// ─── Events ──────────────────────────────────────────────────────────────────

function EventsTable({ rows }: { rows: EventRow[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <TableFrame minWidth={960}>
      <thead className={theadCls}>
        <tr>
          <Th className="w-10">
            <span className="sr-only">Payload</span>
          </Th>
          <Th>Time</Th>
          <Th>Action</Th>
          <Th>By</Th>
          <Th>Agent</Th>
          <Th>Details</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const a = actionLabel(e.action);
          const details = eventDetails(e.payload);
          const isOpen = open.has(e.id);
          return (
            <Fragment key={e.id}>
              <tr className={cn(rowCls, "align-top", isOpen && "border-b-0")}>
                <Td className="pr-0">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={isOpen ? "Hide payload" : "Show payload"}
                    onClick={() => toggle(e.id)}
                    className="grid h-6 w-6 place-items-center rounded-[3px] text-muted outline-none hover:bg-[var(--color-line-soft)] hover:text-ink focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
                  >
                    <ChevronRight size={14} strokeWidth={1.75} className={cn("transition-transform motion-reduce:transition-none", isOpen && "rotate-90")} />
                  </button>
                </Td>
                <Td className="whitespace-nowrap text-ink-2">
                  <Time iso={e.createdAt} />
                </Td>
                <Td className={cn(a.known ? "text-ink" : "mono text-[12.5px] text-ink-2")} >
                  <span title={e.action}>{a.label}</span>
                </Td>
                <Td className="text-ink-2">{byLabel(e.by) ?? <span className="text-muted">{e.actor}</span>}</Td>
                <Td className="mono text-[12.5px] text-ink-2">{e.agentSlug ?? <Dash />}</Td>
                <Td className="text-ink-2">
                  {details ? (
                    <span className="line-clamp-2 max-w-[60ch]" title={details}>
                      {details}
                    </span>
                  ) : (
                    <Dash />
                  )}
                </Td>
              </tr>
              {isOpen ? (
                <tr className={rowCls}>
                  <Td colSpan={6} className="pt-0">
                    <Json value={{ action: e.action, actor: e.actor, conversationId: e.conversationId, payload: e.payload }} />
                  </Td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </TableFrame>
  );
}
