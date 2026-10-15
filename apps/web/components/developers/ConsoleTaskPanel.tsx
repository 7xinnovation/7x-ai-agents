"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Task } from "@dialog/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { artifactData, awaitingOf, isTerminalState, STATE_LABEL, type CaseSummary, type RawExchange, type RpcErrorShape } from "@/app/developers/console/types";

/**
 * The right-hand panel of the Console: the task as the doorway sees it, and
 * the last request/response pair in full.
 */
export function ConsoleTaskPanel({
  task,
  contextId,
  taskId,
  lastCase,
  raw,
  rpcError,
  busy,
  polling,
  onNewTask,
  onNewConversation,
  onCancel,
  onRefresh,
}: {
  task: Task | null;
  contextId: string | null;
  taskId: string | null;
  lastCase: CaseSummary | null;
  raw: RawExchange | null;
  rpcError: RpcErrorShape | null;
  busy: boolean;
  polling: boolean;
  onNewTask: () => void;
  onNewConversation: () => void;
  onCancel: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<"task" | "raw">("task");
  const state = task?.status.state;
  const awaiting = awaitingOf(task);
  const meta = (task?.metadata ?? {}) as Record<string, unknown>;
  const journey = (lastCase?.journey ?? (typeof meta.journey === "string" ? meta.journey : null)) || null;
  const step = lastCase?.step ?? null;
  const collected = Object.entries(lastCase?.collected ?? {});
  const missing = lastCase?.missing ?? [];
  const artifacts = task?.artifacts ?? [];
  const cancellable = Boolean(task && !isTerminalState(state));

  return (
    <aside className="flex flex-col rounded-xl border border-[var(--color-line)] bg-surface shadow-[var(--shadow-xs)]" aria-label="Current task">
      <div className="flex items-center gap-1 border-b border-[var(--color-line-soft)] px-2 pt-2" role="tablist" aria-label="Task panel">
        {(["task", "raw"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-t-lg px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]",
              tab === t ? "border-b-2 border-brand text-brand" : "text-muted hover:text-ink"
            )}
          >
            {t === "task" ? "Task" : "Raw"}
          </button>
        ))}
        <span className="ml-auto pb-1 pr-1">
          {polling ? <span className="mono text-[11px] text-brand">polling GetTask…</span> : null}
        </span>
      </div>

      {tab === "task" ? (
        <div className="flex flex-col gap-4 px-4 py-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            {state ? (
              <span className="dev-state" data-state={state}>
                {STATE_LABEL[state] ?? state}
              </span>
            ) : (
              <span className="dev-state">No task yet</span>
            )}
            {awaiting ? <span className="text-[12.5px] text-muted">awaiting: <span className="mono text-ink-2">{awaiting}</span></span> : null}
          </div>

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <dt className="text-muted">contextId</dt>
            <dd>
              <IdValue value={contextId} />
            </dd>
            <dt className="text-muted">taskId</dt>
            <dd>
              <IdValue value={taskId} />
            </dd>
            <dt className="text-muted">journey</dt>
            <dd className="mono text-ink-2">{journey ?? "—"}</dd>
            <dt className="text-muted">step</dt>
            <dd className="mono text-ink-2">{step ?? "—"}</dd>
            {typeof meta.persona === "string" ? (
              <>
                <dt className="text-muted">persona</dt>
                <dd className="mono text-ink-2">{meta.persona}</dd>
              </>
            ) : null}
            {typeof meta.locale === "string" ? (
              <>
                <dt className="text-muted">locale</dt>
                <dd className="mono text-ink-2">{meta.locale}</dd>
              </>
            ) : null}
            {lastCase?.reference ? (
              <>
                <dt className="text-muted">reference</dt>
                <dd className="mono text-ink-2">{lastCase.reference}</dd>
              </>
            ) : null}
            {lastCase?.payment && lastCase.payment.status !== "none" ? (
              <>
                <dt className="text-muted">payment</dt>
                <dd className="text-ink-2">
                  <span className="mono">{lastCase.payment.status}</span>
                  {lastCase.payment.amount != null ? ` · ${lastCase.payment.currency} ${lastCase.payment.amount}` : ""}
                  {lastCase.payment.reference ? <span className="mono text-muted"> · {lastCase.payment.reference}</span> : null}
                </dd>
              </>
            ) : null}
          </dl>

          <Section title="Collected" count={collected.length}>
            {collected.length ? (
              <table className="w-full text-[12.5px]">
                <tbody>
                  {collected.map(([k, v]) => (
                    <tr key={k} className="border-b border-[var(--color-line-soft)] last:border-0 align-top">
                      <td className="mono py-1 pr-2 text-muted">{k}</td>
                      <td className="py-1 text-ink-2 break-words">{valueText(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-muted">Nothing collected yet.</p>
            )}
          </Section>

          <Section title="Missing" count={missing.length}>
            {missing.length ? (
              <div className="flex flex-wrap gap-1.5">
                {missing.map((m) => (
                  <span key={`${m.kind}-${m.key}`} className="mono rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11.5px] text-ink-2" title={m.kind}>
                    {m.key}
                    <span className="text-muted"> · {m.kind}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted">{lastCase ? "Nothing missing." : "—"}</p>
            )}
          </Section>

          <Section title="Artifacts" count={artifacts.length}>
            {artifacts.length ? (
              <div className="flex flex-col gap-1.5">
                {artifacts.map((a) => (
                  <details key={a.artifactId} className="group rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)]">
                    <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[12.5px] font-medium text-ink marker:text-muted">
                      <span className="mono">{a.name ?? "artifact"}</span>
                      {a.description ? <span className="ml-2 font-normal text-muted">{a.description.split(".")[0]}.</span> : null}
                    </summary>
                    <div className="px-2 pb-2">
                      <CodeBlock code={pretty(artifactData(a) ?? a)} title={a.name ?? "artifact"} lang="json" />
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="text-muted">None yet.</p>
            )}
          </Section>

          {rpcError ? (
            <div role="alert" className="rounded-lg border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-[12.5px] text-[#b42318]">
              <span className="mono font-semibold">{rpcError.code}</span> {rpcError.message}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-[var(--color-line-soft)] pt-3">
            <Button variant="outline" size="sm" onClick={onNewTask} disabled={busy || !contextId}>
              New task in this context
            </Button>
            <Button variant="outline" size="sm" onClick={onNewConversation} disabled={busy}>
              New conversation
            </Button>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy || !taskId}>
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy || !cancellable} className="text-[#b42318] hover:text-[#b42318]">
              Cancel task
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-4">
          {raw ? (
            <>
              <p className="text-[12.5px] text-muted">
                <span className="font-medium text-ink-2">{raw.label}</span> · {new Date(raw.at).toLocaleTimeString()}
              </p>
              <CodeBlock code={pretty(raw.request)} title="request" lang="json" />
              <CodeBlock code={pretty(raw.response)} title="response" lang="json" />
            </>
          ) : (
            <p className="text-[13px] text-muted">The last JSON-RPC request and response appear here.</p>
          )}
        </div>
      )}
    </aside>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
        {title}
        {count ? <span className="mono rounded-full bg-[var(--color-line-soft)] px-1.5 text-[11px] font-medium text-ink-2">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function IdValue({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* the text is selectable */
    }
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className="mono truncate text-[12px] text-ink-2" title={value}>
        {value}
      </span>
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy"} className="rounded p-0.5 text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]">
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}

export const pretty = (v: unknown): string => {
  try {
    return JSON.stringify(v, null, 2) ?? "null";
  } catch {
    return String(v);
  }
};

function valueText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
