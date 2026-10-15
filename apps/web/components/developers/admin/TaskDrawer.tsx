"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { CopyButton, Time, adminApi } from "./ui";
import { Json } from "./table";
import { stateLabel } from "./labels";
import type { TaskDetail } from "./types";
import { cn } from "@/lib/utils";

type Part = { text?: string; data?: unknown; [k: string]: unknown };
type Message = { role?: string; parts?: Part[]; messageId?: string; [k: string]: unknown };
type Artifact = { artifactId?: string; name?: string; description?: string; parts?: Part[] };
type Status = { state?: string; message?: Message; timestamp?: string };

/**
 * One task in full, in a panel on the right (the whole screen on a phone):
 * who it belongs to, its status, the conversation as a transcript and its
 * artifacts. Escape or the close button dismisses it.
 */
export function TaskDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!taskId) return;
    let live = true;
    setTask(null);
    setError(null);
    void adminApi<{ task: TaskDetail }>(`/api/developers/admin/tasks/${encodeURIComponent(taskId)}`).then((r) => {
      if (!live) return;
      if (r.ok) setTask(r.body.task);
      else setError(r.status === 404 ? "This task no longer exists." : `The task could not be loaded (${r.error}).`);
    });
    return () => {
      live = false;
    };
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      returnTo.current?.focus?.();
    };
  }, [taskId, onClose]);

  if (!taskId) return null;

  const history = (Array.isArray(task?.history) ? task.history : []) as Message[];
  const artifacts = (Array.isArray(task?.artifacts) ? task.artifacts : []) as Artifact[];
  const status = (task?.status ?? {}) as Status;
  const statusText = status.message?.parts?.map((p) => p.text).filter(Boolean).join("\n");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[#0f1720]/30" aria-hidden onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-drawer-title"
        className="relative flex h-dvh w-full flex-col border-l border-[var(--color-line)] bg-[var(--color-canvas)] sm:w-[620px] sm:max-w-[92vw]"
        style={{ boxShadow: "var(--shadow-md)" }}
      >
        <div className="flex items-center gap-3 border-b border-[var(--color-line)] bg-white px-5 py-3">
          <h2 id="task-drawer-title" className="text-[15px] font-semibold text-ink">
            Task
          </h2>
          {task ? (
            <span className="dev-state" data-state={task.state}>
              {stateLabel(task.state)}
            </span>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto grid h-8 w-8 place-items-center rounded-[3px] text-muted outline-none hover:bg-[var(--color-line-soft)] hover:text-ink focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <p role="alert" className="border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-[13.5px] text-[#b42318]">
              {error}
            </p>
          ) : !task ? (
            <p className="text-[13.5px] text-muted" role="status">
              Loading the task…
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              <dl className="grid grid-cols-[112px_minmax(0,1fr)] [&>*:nth-last-child(-n+2)]:border-0 border border-[var(--color-line)] bg-white px-4 py-1 text-[13px]">
                <Row label="Task ID">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <span className="mono truncate text-[12px]">{task.id}</span>
                    <CopyButton value={task.id} label="task ID" />
                  </span>
                </Row>
                <Row label="Context ID">
                  <span className="mono break-all text-[12px]">{task.contextId ?? "-"}</span>
                </Row>
                <Row label="Application">{task.appName ?? "-"}</Row>
                <Row label="Account">
                  <span className="mono text-[12px]">{task.accountEmail ?? "-"}</span>
                </Row>
                <Row label="Agent">
                  <span className="mono text-[12px]">{task.agentSlug}</span>
                </Row>
                <Row label="Awaiting">{task.awaiting ? <span className="mono text-[12px]">{task.awaiting}</span> : "-"}</Row>
                <Row label="Created">
                  <Time iso={task.createdAt} mode="absolute" />
                </Row>
                <Row label="Updated">
                  <Time iso={task.updatedAt} />
                </Row>
              </dl>

              <section aria-labelledby="td-status">
                <h3 id="td-status" className="text-[13px] font-semibold text-ink">
                  Status
                </h3>
                <div className="mt-2 border border-[var(--color-line)] bg-white px-4 py-3 text-[13px] text-ink-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="dev-state" data-state={status.state ?? task.state}>
                      {stateLabel(status.state ?? task.state)}
                    </span>
                    {status.timestamp ? (
                      <span className="text-[12.5px] text-muted">
                        <Time iso={status.timestamp} mode="absolute" />
                      </span>
                    ) : null}
                  </div>
                  {statusText ? <p className="mt-2 whitespace-pre-wrap">{statusText.replace(/\*\*/g, "")}</p> : null}
                </div>
              </section>

              <section aria-labelledby="td-history">
                <h3 id="td-history" className="text-[13px] font-semibold text-ink">
                  Conversation <span className="font-normal text-muted">({history.length} messages)</span>
                </h3>
                {history.length ? (
                  <ol className="mt-2 flex flex-col gap-3">
                    {history.map((m, i) => (
                      <Bubble key={m.messageId ?? i} message={m} />
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-[13px] text-muted">No messages.</p>
                )}
              </section>

              <section aria-labelledby="td-artifacts">
                <h3 id="td-artifacts" className="text-[13px] font-semibold text-ink">
                  Artifacts <span className="font-normal text-muted">({artifacts.length})</span>
                </h3>
                {artifacts.length ? (
                  <ul className="mt-2 flex flex-col gap-3">
                    {artifacts.map((a, i) => (
                      <li key={a.artifactId ?? i} className="border border-[var(--color-line)] bg-white">
                        <div className="border-b border-[var(--color-line)] px-4 py-2 text-[13px]">
                          <span className="mono font-medium text-ink">{a.name ?? "artifact"}</span>
                          {a.description ? <span className="mt-0.5 block text-[12.5px] text-muted">{a.description}</span> : null}
                        </div>
                        <Json value={(a.parts ?? []).map((p) => ("data" in p ? p.data : p))} className="rounded-none border-0" />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[13px] text-muted">No artifacts.</p>
                )}
              </section>

              {task.metadata && Object.keys(task.metadata as object).length ? (
                <details className="border border-[var(--color-line)] bg-white">
                  <summary className="cursor-pointer px-4 py-2 text-[13px] font-medium text-ink-2">Metadata</summary>
                  <Json value={task.metadata} className="rounded-none border-0" />
                </details>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="border-b border-[var(--color-line-soft)] py-2 text-muted">{label}</dt>
      <dd className="min-w-0 border-b border-[var(--color-line-soft)] py-2 text-ink">{children}</dd>
    </>
  );
}

function Bubble({ message }: { message: Message }) {
  const user = message.role === "ROLE_USER";
  const parts = message.parts ?? [];
  const texts = parts.filter((p) => typeof p.text === "string" && p.text);
  const data = parts.filter((p) => !(typeof p.text === "string" && p.text)).map((p) => ("data" in p ? p.data : p));
  return (
    <li className={cn("flex flex-col", user ? "items-end" : "items-start")}>
      <span className="mb-1 text-[11.5px] text-muted">{user ? "User" : "Agent"}</span>
      <div
        className={cn(
          "max-w-[88%] rounded-[3px] border px-3.5 py-2.5 text-[13.5px] leading-relaxed",
          user ? "border-[var(--color-ring)] bg-[color-mix(in_srgb,#1330f0_6%,white)] text-ink" : "border-[var(--color-line)] bg-white text-ink-2"
        )}
      >
        {texts.map((p, i) => (
          <p key={i} className="whitespace-pre-wrap break-words [&+p]:mt-2">
            {user ? p.text : p.text?.replace(/\*\*/g, "")}
          </p>
        ))}
        {data.length ? (
          <details className={cn(texts.length && "mt-2")}>
            <summary className="cursor-pointer text-[12.5px] font-medium text-muted hover:text-ink">Structured data</summary>
            <Json value={data.length === 1 ? data[0] : data} className="mt-2 max-w-full" />
          </details>
        ) : null}
        {!texts.length && !data.length ? <span className="text-muted">Empty message</span> : null}
      </div>
    </li>
  );
}
