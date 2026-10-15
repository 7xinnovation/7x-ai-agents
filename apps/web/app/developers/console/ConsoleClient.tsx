"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import type { Message, StreamResponse, Task } from "@dialog/core";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { ConsoleBlocks, type PaymentControls } from "@/components/developers/ConsoleBlocks";
import { ConsoleTaskPanel } from "@/components/developers/ConsoleTaskPanel";
import { rpcStream, rpcUnary, settleSandboxPayment, type RpcFrame, type RpcRequest } from "./a2aClient";
import {
  awaitingOf,
  currentPayment,
  isTerminalState,
  messageTextOf,
  newUuid,
  replyDataOf,
  STATE_LABEL,
  type CaseSummary,
  type ConsoleAgent,
  type ConsoleApp,
  type ConsolePersona,
  type RawExchange,
  type RpcErrorShape,
  type TranscriptEntry,
} from "./types";

interface TokenState {
  value: string;
  expiresAt: number;
  clientId: string;
}

interface Props {
  apps: ConsoleApp[];
  agent: ConsoleAgent;
  personas: ConsolePersona[];
  identityExtension: string;
  replyExtension: string;
}

const NONE = "none";

/**
 * The Console. One conversation at a time: an application, a persona, a
 * locale, and the choice between SendMessage and SendStreamingMessage. The
 * transcript on the left renders the agent's text and its blocks as controls;
 * the panel on the right shows the task and the raw exchange.
 */
export function ConsoleClient({ apps, agent, personas, identityExtension }: Props) {
  const [appId, setAppId] = useState(apps[0]?.id ?? "");
  const [token, setToken] = useState<TokenState | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [persona, setPersona] = useState<string>(personas.find((p) => p.signedIn)?.id ?? NONE);
  const [locale, setLocale] = useState<"en" | "ar">("en");
  const [streaming, setStreaming] = useState(true);

  const [contextId, setContextId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [partial, setPartial] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState(false);
  const [polling, setPolling] = useState(false);
  const [raw, setRaw] = useState<RawExchange | null>(null);
  const [rpcError, setRpcError] = useState<RpcErrorShape | null>(null);
  const [draft, setDraft] = useState("");

  const seq = useRef(0);
  const seen = useRef(new Set<string>());
  const pollTimer = useRef<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ token, contextId, taskId, task, persona, locale, streaming, busy });
  latest.current = { token, contextId, taskId, task, persona, locale, streaming, busy };

  const nowIso = () => new Date().toISOString();
  const push = useCallback((entry: TranscriptEntry) => setTranscript((t) => [...t, entry]), []);
  const note = useCallback((text: string, tone: "muted" | "error" | "ok" = "muted") => push({ kind: "note", id: newUuid(), text, tone, at: nowIso() }), [push]);

  // ── Token ──────────────────────────────────────────────────────────────────

  const mint = useCallback(async (id: string): Promise<TokenState | null> => {
    if (!id) return null;
    setTokenBusy(true);
    setTokenError(null);
    try {
      const res = await fetch(`/api/developers/apps/${id}/token`, { method: "POST", headers: { Accept: "application/json" } });
      if (res.status === 401) {
        setTokenError("Your portal session has ended. Sign in again to continue.");
        setToken(null);
        return null;
      }
      if (!res.ok) {
        setTokenError(`The token could not be issued (${res.status}).`);
        setToken(null);
        return null;
      }
      const body = (await res.json()) as { access_token: string; expires_in: number; clientId: string };
      const t: TokenState = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000, clientId: body.clientId };
      setToken(t);
      return t;
    } catch {
      setTokenError("The token could not be issued: the request did not reach the portal.");
      setToken(null);
      return null;
    } finally {
      setTokenBusy(false);
    }
  }, []);

  useEffect(() => {
    void mint(appId);
  }, [appId, mint]);

  /** A token with at least half a minute left, minting a fresh one otherwise. */
  const ensureToken = useCallback(async (): Promise<string | null> => {
    const t = latest.current.token;
    if (t && t.expiresAt - Date.now() > 30_000) return t.value;
    const fresh = await mint(appId);
    return fresh?.value ?? null;
  }, [appId, mint]);

  // ── Task bookkeeping ───────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
    setPolling(false);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const appendAgent = useCallback(
    (m: Message | undefined, state: Task["status"]["state"], at: string | undefined) => {
      if (!m || seen.current.has(m.messageId)) return;
      seen.current.add(m.messageId);
      push({ kind: "agent", id: m.messageId, messageId: m.messageId, text: messageTextOf(m), data: replyDataOf(m), state, at: at ?? nowIso() });
    },
    [push]
  );

  /** Take a task as the doorway returned it: ids, state, artifacts, and its reply if new. */
  const absorbTask = useCallback(
    (t: Task) => {
      setTask(t);
      setContextId(t.contextId);
      setTaskId(t.id);
      if (t.status.message?.role === "ROLE_AGENT" && t.status.state !== "TASK_STATE_WORKING") appendAgent(t.status.message, t.status.state, t.status.timestamp);
    },
    [appendAgent]
  );

  const quietGetTask = useCallback(
    async (tok: string, id: string): Promise<Task | null> => {
      const body: RpcRequest = { jsonrpc: "2.0", id: ++seq.current, method: "GetTask", params: { id, historyLength: 0 } };
      try {
        const { frame } = await rpcUnary({ agentKey: agent.key, token: tok }, body);
        if ("error" in frame) {
          setRpcError(frame.error);
          return null;
        }
        return frame.result as Task;
      } catch {
        return null;
      }
    },
    [agent.key]
  );

  /** Poll GetTask every 3 s until the task has left WORKING and is not waiting for a payment. */
  const startPolling = useCallback(
    (id: string, maxMs: number) => {
      stopPolling();
      setPolling(true);
      const startedAt = Date.now();
      const tick = async () => {
        const tok = await ensureToken();
        if (!tok) {
          stopPolling();
          return;
        }
        const t = await quietGetTask(tok, id);
        if (t) {
          absorbTask(t);
          if (t.status.state !== "TASK_STATE_WORKING" && awaitingOf(t) !== "payment") {
            stopPolling();
            return;
          }
        }
        if (Date.now() - startedAt > maxMs) {
          stopPolling();
          note("Stopped waiting. The task still waits for its payment; settle it, refresh, or cancel the task.");
          return;
        }
        pollTimer.current = window.setTimeout(() => void tick(), 3000);
      };
      pollTimer.current = window.setTimeout(() => void tick(), 3000);
    },
    [absorbTask, ensureToken, note, quietGetTask, stopPolling]
  );

  // ── Sending ────────────────────────────────────────────────────────────────

  const send = useCallback(
    async (rawText: string, opts: { allowEmpty?: boolean } = {}) => {
      const text = rawText.trim();
      const L = latest.current;
      if ((!text && !opts.allowEmpty) || L.busy) return;
      const tok = await ensureToken();
      if (!tok) return;
      stopPolling();
      setBusy(true);
      setRpcError(null);

      // A message to a finished task is refused by the doorway; the next one
      // opens a new task in the same conversation instead.
      const startsNewTask = Boolean(L.task && isTerminalState(L.task.status.state));
      const useTaskId = startsNewTask ? null : L.taskId;
      if (startsNewTask) {
        push({ kind: "divider", id: newUuid(), text: "New task in the same conversation" });
        setTask(null);
        setTaskId(null);
      }

      const message = {
        messageId: newUuid(),
        role: "ROLE_USER" as const,
        parts: [{ text }],
        ...(L.contextId ? { contextId: L.contextId } : {}),
        ...(useTaskId ? { taskId: useTaskId } : {}),
        metadata: {
          ...(L.persona !== NONE ? { [identityExtension]: { persona: L.persona } } : {}),
          locale: L.locale,
        },
      };
      const method = L.streaming ? "SendStreamingMessage" : "SendMessage";
      const body: RpcRequest = { jsonrpc: "2.0", id: ++seq.current, method, params: { message, configuration: { historyLength: 0 } } };
      push({ kind: "user", id: message.messageId, text: text || "(empty message: sign the customer in and show the account)", at: nowIso() });
      setDraft("");
      const auth = { agentKey: agent.key, token: tok };

      try {
        if (L.streaming) {
          const frames: RpcFrame[] = [];
          let streamedId: string | null = null;
          let sawFinal = false;
          setPartial("");
          await rpcStream(auth, body, (f) => {
            frames.push(f);
            if ("error" in f) {
              setRpcError(f.error);
              note(`Error ${f.error.code}: ${f.error.message}`, "error");
              return;
            }
            const ev = f.result as StreamResponse;
            if ("task" in ev) {
              streamedId = ev.task.id;
              setTask(ev.task);
              setContextId(ev.task.contextId);
              setTaskId(ev.task.id);
            } else if ("statusUpdate" in ev) {
              const st = ev.statusUpdate.status;
              streamedId = streamedId ?? ev.statusUpdate.taskId;
              if (st.state === "TASK_STATE_WORKING") {
                const t = messageTextOf(st.message);
                if (t) setPartial(t);
              } else {
                sawFinal = true;
                setPartial(null);
                setTask((prev) => (prev ? { ...prev, status: st } : prev));
                appendAgent(st.message, st.state, st.timestamp);
              }
            } else if ("artifactUpdate" in ev) {
              const a = ev.artifactUpdate.artifact;
              setTask((prev) => (prev ? { ...prev, artifacts: [...(prev.artifacts ?? []).filter((x) => x.artifactId !== a.artifactId), a] } : prev));
            }
          });
          setRaw({ label: "SendStreamingMessage · SSE frames", request: body, response: frames, at: nowIso() });
          setPartial(null);
          // The stream carries status and artifacts; the task's metadata
          // (awaiting, journey) comes from a quiet GetTask afterwards.
          if (streamedId) {
            const fresh = await quietGetTask(tok, streamedId);
            if (fresh) absorbTask(fresh);
            else if (!sawFinal) note("The stream closed before the task rested. Refresh the task to see where it stands.");
          }
        } else {
          const { frame } = await rpcUnary(auth, body);
          setRaw({ label: "SendMessage", request: body, response: frame, at: nowIso() });
          if ("error" in frame) {
            setRpcError(frame.error);
            note(`Error ${frame.error.code}: ${frame.error.message}`, "error");
          } else {
            const r = frame.result as { task?: Task };
            if (r?.task) absorbTask(r.task);
          }
        }
      } catch (e) {
        setPartial(null);
        note(`The request did not complete: ${e instanceof Error ? e.message : String(e)}`, "error");
      } finally {
        setBusy(false);
      }
    },
    [absorbTask, agent.key, appendAgent, ensureToken, identityExtension, note, push, quietGetTask, stopPolling]
  );

  // ── Other operations ───────────────────────────────────────────────────────

  const cancel = useCallback(async () => {
    const id = latest.current.taskId;
    if (!id || latest.current.busy) return;
    const tok = await ensureToken();
    if (!tok) return;
    stopPolling();
    setBusy(true);
    setRpcError(null);
    const body: RpcRequest = { jsonrpc: "2.0", id: ++seq.current, method: "CancelTask", params: { id } };
    try {
      const { frame } = await rpcUnary({ agentKey: agent.key, token: tok }, body);
      setRaw({ label: "CancelTask", request: body, response: frame, at: nowIso() });
      if ("error" in frame) {
        setRpcError(frame.error);
        note(`Error ${frame.error.code}: ${frame.error.message}`, "error");
      } else absorbTask(frame.result as Task);
    } catch (e) {
      note(`The request did not complete: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }, [absorbTask, agent.key, ensureToken, note, stopPolling]);

  const refresh = useCallback(async () => {
    const id = latest.current.taskId;
    if (!id) return;
    const tok = await ensureToken();
    if (!tok) return;
    const body: RpcRequest = { jsonrpc: "2.0", id: ++seq.current, method: "GetTask", params: { id, historyLength: 0 } };
    try {
      const { frame } = await rpcUnary({ agentKey: agent.key, token: tok }, body);
      setRaw({ label: "GetTask", request: body, response: frame, at: nowIso() });
      if ("error" in frame) setRpcError(frame.error);
      else absorbTask(frame.result as Task);
    } catch (e) {
      note(`The request did not complete: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [absorbTask, agent.key, ensureToken, note]);

  const settle = useCallback(
    async (settleUrl: string, outcome: "paid" | "failed") => {
      const id = latest.current.taskId;
      const tok = await ensureToken();
      if (!tok || !id) return;
      setSettling(true);
      setRpcError(null);
      try {
        const { ok, http, body } = await settleSandboxPayment(tok, settleUrl, outcome);
        setRaw({ label: `POST sandbox settle · ${outcome}`, request: { method: "POST", url: settleUrl, body: { outcome } }, response: body, at: nowIso() });
        if (!ok) {
          const err = (body as { error?: { code?: number; message?: string } } | null)?.error;
          note(`The payment could not be settled (${http})${err?.message ? `: ${err.message}` : ""}.`, "error");
          return;
        }
        const ref = (body as { reference?: string } | null)?.reference ?? "";
        if (outcome === "paid") {
          note(`Sandbox payment ${ref} settled as paid. The task continues by itself; polling GetTask every 3 s.`, "ok");
          startPolling(id, 5 * 60_000);
        } else {
          note(`Sandbox payment ${ref} marked failed. The task keeps waiting for a payment; send a message to continue, or cancel the task.`);
          void refresh();
        }
      } catch (e) {
        note(`The request did not complete: ${e instanceof Error ? e.message : String(e)}`, "error");
      } finally {
        setSettling(false);
      }
    },
    [ensureToken, note, refresh, startPolling]
  );

  const newTask = useCallback(() => {
    stopPolling();
    setTask(null);
    setTaskId(null);
    setRpcError(null);
    push({ kind: "divider", id: newUuid(), text: "New task in the same conversation" });
  }, [push, stopPolling]);

  const newConversation = useCallback(() => {
    stopPolling();
    setTask(null);
    setTaskId(null);
    setContextId(null);
    setRpcError(null);
    setRaw(null);
    setPartial(null);
    setTranscript([]);
    seen.current = new Set();
  }, [stopPolling]);

  // Scroll the transcript to its end whenever it grows or streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [transcript.length, partial]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const lastAgent = [...transcript].reverse().find((e): e is Extract<TranscriptEntry, { kind: "agent" }> => e.kind === "agent") ?? null;
  const lastCase: CaseSummary | null = lastAgent?.data?.case ?? null;
  const payment = currentPayment(task);
  const activePersona = personas.find((p) => p.id === persona) ?? null;
  const composerDisabled = busy || !token || settling;
  const authRequired = task?.status.state === "TASK_STATE_AUTH_REQUIRED";

  const paymentControlsFor = (entry: Extract<TranscriptEntry, { kind: "agent" }>): PaymentControls | null => {
    const isLatest = lastAgent?.id === entry.id;
    const active = Boolean(isLatest && payment && awaitingOf(task) === "payment");
    return {
      reference: payment?.data.reference ?? null,
      settleUrl: payment?.data.sandbox?.settleUrl ?? null,
      active,
      settling,
      onSettle: (outcome) => {
        const url = payment?.data.sandbox?.settleUrl;
        if (url) void settle(url, outcome);
      },
      onOpenCheckout: () => {
        if (active && taskId) startPolling(taskId, 10 * 60_000);
      },
    };
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="grid gap-3 rounded-xl border border-[var(--color-line)] bg-surface p-3 shadow-[var(--shadow-xs)] sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_auto]">
        <div className="flex flex-col gap-1">
          <label htmlFor="console-app" className="text-[12px] font-medium text-ink-2">
            Application
          </label>
          <Select
            id="console-app"
            value={appId}
            disabled={busy}
            onChange={(e) => {
              setAppId(e.target.value);
              newConversation();
            }}
          >
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.clientId}
              </option>
            ))}
          </Select>
          <TokenLine token={token} busy={tokenBusy} error={tokenError} onRenew={() => void mint(appId)} />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="console-persona" className="text-[12px] font-medium text-ink-2">
            Citizen identity (sandbox persona)
          </label>
          <Select id="console-persona" value={persona} onChange={(e) => setPersona(e.target.value)}>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.id}
                {p.signedIn ? " · signed in" : ""}
              </option>
            ))}
            <option value={NONE}>None · no identity in the message</option>
          </Select>
          <p className="text-[11.5px] text-muted" title={activePersona?.description}>
            {activePersona ? (activePersona.signedIn ? "Signed in via UAE PASS; boxes on file." : "No sign-in; a rental will ask for one.") : "The agent treats the customer as anonymous."}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="console-locale" className="text-[12px] font-medium text-ink-2">
            Locale
          </label>
          <Select id="console-locale" value={locale} onChange={(e) => setLocale(e.target.value === "ar" ? "ar" : "en")}>
            <option value="en">en · English</option>
            <option value="ar">ar · العربية</option>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Transport</span>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#d0d5dd] bg-surface px-3 text-[13px] text-ink-2 shadow-[var(--shadow-xs)]">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} />
            Streaming
          </label>
          <p className="mono text-[11px] text-muted">{streaming ? "SendStreamingMessage" : "SendMessage"}</p>
        </div>
      </div>

      {/* Body */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-h-[520px] flex-col rounded-xl border border-[var(--color-line)] bg-surface shadow-[var(--shadow-xs)]" aria-label="Conversation">
          <div className="flex-1 overflow-y-auto px-4 py-4 lg:max-h-[calc(100dvh-330px)]">
            {transcript.length === 0 && !partial ? (
              <Empty agentName={agent.name} persona={activePersona} onSend={(t) => void send(t)} disabled={composerDisabled} />
            ) : (
              <ol className="flex flex-col gap-4">
                {transcript.map((e) => (
                  <li key={e.id}>
                    <Entry entry={e} disabled={composerDisabled} onSend={(t) => void send(t)} payment={e.kind === "agent" ? paymentControlsFor(e) : null} />
                  </li>
                ))}
                {partial !== null ? (
                  <li aria-live="polite">
                    <AgentBubble state="TASK_STATE_WORKING">
                      {partial ? <Paragraphs text={partial} /> : <span className="text-muted">The agent is answering…</span>}
                      <span className="ml-1 inline-block h-3.5 w-0.5 translate-y-0.5 animate-pulse bg-brand" aria-hidden />
                    </AgentBubble>
                  </li>
                ) : busy ? (
                  <li aria-live="polite">
                    <AgentBubble state="TASK_STATE_WORKING">
                      <span className="inline-flex items-center gap-2 text-muted">
                        <Loader2 size={14} className="animate-spin" /> Waiting for the turn to end…
                      </span>
                    </AgentBubble>
                  </li>
                ) : null}
                {authRequired && !busy ? (
                  <li>
                    <AuthPrompt persona={activePersona} onContinue={() => void send("", { allowEmpty: true })} />
                  </li>
                ) : null}
              </ol>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="border-t border-[var(--color-line-soft)] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <label htmlFor="console-composer" className="sr-only">
              Message to the agent
            </label>
            <div className="flex items-end gap-2">
              <Textarea
                id="console-composer"
                rows={2}
                value={draft}
                disabled={composerDisabled}
                placeholder={token ? (task && isTerminalState(task.status.state) ? "The task is finished; the next message starts a new task in this conversation." : "What the customer says…") : "Waiting for a token…"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                className="min-h-[44px] resize-none"
              />
              <Button type="submit" disabled={composerDisabled || !draft.trim()} className="shrink-0">
                Send
              </Button>
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted">Enter sends, Shift+Enter for a new line. One turn at a time.</p>
          </form>
        </section>

        <ConsoleTaskPanel
          task={task}
          contextId={contextId}
          taskId={taskId}
          lastCase={lastCase}
          raw={raw}
          rpcError={rpcError}
          busy={busy}
          polling={polling}
          onNewTask={newTask}
          onNewConversation={newConversation}
          onCancel={() => void cancel()}
          onRefresh={() => void refresh()}
        />
      </div>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function TokenLine({ token, busy, error, onRenew }: { token: TokenState | null; busy: boolean; error: string | null; onRenew: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, []);
  const left = token ? Math.max(0, Math.floor((token.expiresAt - now) / 1000)) : 0;
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <p className="flex items-center gap-2 text-[11.5px] text-muted" aria-live="polite">
      {error ? (
        <span className="text-[#b42318]">
          {error}{" "}
          {error.includes("Sign in") ? (
            <Link href="/developers/login?next=/developers/console" className="underline">
              Sign in
            </Link>
          ) : null}
        </span>
      ) : busy ? (
        <span className="inline-flex items-center gap-1">
          <Loader2 size={12} className="animate-spin" /> Minting a token…
        </span>
      ) : token ? (
        <span>
          Token expires in <span className={cn("mono", left < 120 && "text-[#b54708]")}>{mm}:{ss}</span>
        </span>
      ) : (
        <span>No token.</span>
      )}
      <button type="button" onClick={onRenew} disabled={busy} className="inline-flex items-center gap-1 rounded px-1 text-brand hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]">
        <RefreshCw size={11} /> Renew
      </button>
    </p>
  );
}

function Empty({ agentName, persona, onSend, disabled }: { agentName: string; persona: ConsolePersona | null; onSend: (t: string) => void; disabled: boolean }) {
  const suggestions = persona?.signedIn
    ? ["Renew my PO Box 50500 in Dubai for one more year", "When does my PO Box expire?", "Switch on auto-renewal for my Dubai box", "I want to rent a PO Box in Dubai"]
    : ["How much is a PO Box in Abu Dhabi?", "Which branches are near Al Barsha?", "I need to renew box 33417 in Abu Dhabi", "I want to rent a PO Box in Dubai"];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-10 text-center">
      <div>
        <p className="text-[15px] font-medium text-ink">{agentName}</p>
        <p className="mx-auto mt-1 max-w-[48ch] text-[13px] text-muted">
          The first message opens a conversation (a <span className="mono">contextId</span>) and a task. The identity you chose above travels inside it.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onSend(s)}
            className="rounded-full border border-[var(--color-line)] bg-surface px-3 py-1.5 text-[13px] text-ink-2 shadow-[var(--shadow-xs)] hover:border-[var(--color-brand)] hover:text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)] disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Entry({ entry, disabled, onSend, payment }: { entry: TranscriptEntry; disabled: boolean; onSend: (t: string) => void; payment: PaymentControls | null }) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#0a0b0d] px-4 py-2.5 text-[14px] leading-relaxed text-white">
            <Paragraphs text={entry.text} />
          </div>
        </div>
      );
    case "agent":
      return (
        <AgentBubble state={entry.state} at={entry.at}>
          <Paragraphs text={entry.text} />
          {entry.data?.warning ? <p className="mt-2 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-2.5 py-1.5 text-[12.5px] text-[#b54708]">warning: {entry.data.warning}</p> : null}
          <ConsoleBlocks blocks={entry.data?.blocks ?? []} disabled={disabled} onSend={onSend} payment={payment} />
        </AgentBubble>
      );
    case "note":
      return (
        <p
          role={entry.tone === "error" ? "alert" : undefined}
          className={cn(
            "mx-auto max-w-[90%] rounded-lg px-3 py-1.5 text-center text-[12.5px]",
            entry.tone === "error" && "border border-[#fecdca] bg-[#fef3f2] text-[#b42318]",
            entry.tone === "ok" && "border border-[#abefc6] bg-[#ecfdf3] text-[#067647]",
            entry.tone === "muted" && "text-muted"
          )}
        >
          {entry.text}
        </p>
      );
    case "divider":
      return (
        <div className="flex items-center gap-3 text-[11.5px] uppercase tracking-wide text-muted">
          <span className="h-px flex-1 bg-[var(--color-line)]" />
          {entry.text}
          <span className="h-px flex-1 bg-[var(--color-line)]" />
        </div>
      );
    default:
      return null;
  }
}

function AgentBubble({ state, at, children }: { state: Task["status"]["state"]; at?: string; children: React.ReactNode }) {
  const quiet = state === "TASK_STATE_INPUT_REQUIRED" || state === "TASK_STATE_WORKING";
  return (
    <div className="flex flex-col gap-1">
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-[14px] leading-relaxed text-ink">{children}</div>
      <div className="flex items-center gap-2 pl-1 text-[11px] text-muted">
        {!quiet ? (
          <span className="dev-state" data-state={state}>
            {STATE_LABEL[state] ?? state}
          </span>
        ) : null}
        {at ? <time dateTime={at}>{new Date(at).toLocaleTimeString()}</time> : null}
      </div>
    </div>
  );
}

function AuthPrompt({ persona, onContinue }: { persona: ConsolePersona | null; onContinue: () => void }) {
  const signedIn = Boolean(persona?.signedIn);
  return (
    <div className="rounded-xl border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-[13px] text-[#b54708]">
      <p className="font-medium">The agent needs the customer signed in.</p>
      {signedIn ? (
        <>
          <p className="mt-0.5">
            Resend with the citizen identity. An empty message with the identity signs <strong>{persona!.label}</strong> in and shows the account.
          </p>
          <Button size="sm" className="mt-2" onClick={onContinue}>
            Continue as {persona!.label}
          </Button>
        </>
      ) : (
        <p className="mt-0.5">Choose a signed-in persona in the top bar, then send the next message; the identity travels with it.</p>
      )}
    </div>
  );
}

function Paragraphs({ text }: { text: string }) {
  const parts = text.split(/\n{2,}/).filter((p) => p.trim());
  if (!parts.length) return null;
  return (
    <>
      {parts.map((p, i) => (
        <p key={i} className={cn("whitespace-pre-wrap break-words", i > 0 && "mt-2")}>
          {p}
        </p>
      ))}
    </>
  );
}
