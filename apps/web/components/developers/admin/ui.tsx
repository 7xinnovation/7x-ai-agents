"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { btnDanger, btnPrimary, btnSecondary } from "./styles";
import { absolute, relative } from "./labels";

// ─── Fetch ───────────────────────────────────────────────────────────────────

export type ApiResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; error: string; message?: string; body: Record<string, unknown> };

/** Same-origin JSON with the portal cookie; a lapsed session goes back to sign-in. */
export async function adminApi<T>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  } catch {
    return { ok: false, status: 0, error: "network", message: "The server could not be reached.", body: {} };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) {
    window.location.assign(`/developers/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    return { ok: false, status: 401, error: "unauthenticated", body };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: typeof body.error === "string" ? body.error : `http_${res.status}`,
      message: typeof body.message === "string" ? body.message : undefined,
      body,
    };
  }
  return { ok: true, status: res.status, body: body as T };
}

// ─── Time ────────────────────────────────────────────────────────────────────

/** One shared clock for every relative time on the page, ticking every 30 seconds. */
let nowValue = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    nowValue = Date.now();
    timer = setInterval(() => {
      nowValue = Date.now();
      listeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
const snapshot = () => nowValue || (nowValue = Date.now());
const serverSnapshot = () => 0;

/** Relative after hydration, absolute on the server; always absolute in the title. */
export function Time({ iso, mode = "relative" }: { iso: string | null; mode?: "relative" | "absolute" }) {
  const now = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!iso) return <span className="text-muted">-</span>;
  const abs = absolute(iso);
  return (
    <time dateTime={iso} title={abs} suppressHydrationWarning>
      {mode === "absolute" || !now ? abs : relative(iso, now)}
    </time>
  );
}

// ─── Small parts ─────────────────────────────────────────────────────────────

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? `${label} copied` : `Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard refused: the value is visible and selectable */
        }
      }}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-muted outline-none transition-colors hover:bg-[var(--color-line-soft)] hover:text-ink focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
    >
      {done ? <Check size={12} strokeWidth={2} className="text-[#067647]" /> : <Copy size={12} strokeWidth={1.75} />}
    </button>
  );
}

export type NoteValue = { tone: "ok" | "error"; text: string };

export function Notice({ note, onDismiss }: { note: NoteValue | null; onDismiss?: () => void }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {note ? (
        <div
          role={note.tone === "error" ? "alert" : "status"}
          className={cn(
            "mt-5 flex items-start justify-between gap-3 border px-4 py-3 text-[13.5px]",
            note.tone === "error" ? "border-[#fecdca] bg-[#fef3f2] text-[#b42318]" : "border-[var(--color-line)] bg-white text-ink-2"
          )}
        >
          <span>{note.text}</span>
          {onDismiss ? (
            <button type="button" onClick={onDismiss} className="shrink-0 text-[12.5px] font-medium text-muted hover:text-ink">
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** An inline confirmation: one plain sentence, then Confirm and Cancel. */
export function Confirm({
  text,
  confirmLabel = "Confirm",
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  text: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="group" aria-label="Confirm" className="border border-[var(--color-line)] bg-white px-4 py-3">
      <p className="max-w-[72ch] text-[13.5px] text-ink-2">{text}</p>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-[#b42318]">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={danger ? btnDanger : btnPrimary} onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

