/**
 * A2A tasks on top of Dialog conversations.
 *
 * The doorway does not run the model itself. Every message becomes a turn of
 * the same engine the chat widget uses — POST /api/chat, called in-process — so
 * an integrator exercises exactly what a customer gets: the journeys, the
 * Emirates Post tools, the guards, the payment handling, the audit trail. This
 * module translates between the two vocabularies:
 *
 *   A2A contextId  ↔  Dialog conversation
 *   A2A task       ↔  one service request inside that conversation
 *   task status    ←  what the turn produced: a question (INPUT_REQUIRED), a
 *                     sign-in request (AUTH_REQUIRED), a payment to make
 *                     (INPUT_REQUIRED, awaiting payment), an outcome (COMPLETED)
 *   artifacts      ←  the payment request, the service outcome, an escalation
 *
 * Streaming is a small in-process bus keyed by task id; the app runs as one
 * Node process per environment, which is what that assumes.
 */
import { NextRequest } from "next/server";
import { and, asc, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { getDb, a2aTasks, payments } from "@dialog/db";
import type { CaseState } from "@dialog/config";
import {
  A2AError,
  agentMessage,
  dataPart,
  isTerminal,
  messageText,
  newId,
  nowIso,
  status as mkStatus,
  textPart,
  validateInboundMessage,
  withHistory,
  type Artifact,
  type ListTasksRequest,
  type ListTasksResponse,
  type Message,
  type SendMessageRequest,
  type StreamResponse,
  type Task,
  type TaskState,
  type TaskStatus,
} from "@dialog/core";
import { getAgentBySlug } from "@/lib/agents";
import { getCase, getOrCreateSession } from "@/lib/conversation";
import { POST as chatPost } from "@/app/api/chat/route";
import { log } from "@/lib/logger";
import { parseReply, type ReplyBlock } from "./blocks";
import { DIALOG_REPLY_EXTENSION, type A2AAgentEntry } from "./catalogue";
import { applyCitizenIdentity, citizenIdentityIn } from "./identity";
import type { AuthedApp } from "./auth";

export interface A2AContext {
  entry: A2AAgentEntry;
  app: AuthedApp;
  /** The public origin the request arrived on, for the links we hand out. */
  origin: string;
  /** Forwarded to the engine so the links IT builds are on the same origin. */
  forwardedHost?: string;
  forwardedProto?: string;
}

type Row = typeof a2aTasks.$inferSelect;
type Awaiting = "input" | "auth" | "payment";

/** A turn that has run longer than this is presumed dead and its lock is released. */
const STALE_WORKING_MS = 6 * 60 * 1000;
/** The engine's own limit is 300s; a turn that has not finished by then is given up on, not waited for. */
const TURN_DEADLINE_MS = 280 * 1000;

// ─── The event bus ───────────────────────────────────────────────────────────

type Listener = (ev: StreamResponse) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(taskId: string, fn: Listener): () => void {
  const set = listeners.get(taskId) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(taskId, set);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(taskId);
  };
}

function publish(taskId: string, ev: StreamResponse): void {
  for (const fn of listeners.get(taskId) ?? []) {
    try {
      fn(ev);
    } catch {
      /* a broken listener is not the task's problem */
    }
  }
}

// ─── Rows and tasks ──────────────────────────────────────────────────────────

export function rowToTask(row: Row, historyLength?: number, includeArtifacts = true): Task {
  const task: Task = {
    id: row.id,
    contextId: row.conversationId,
    status: row.status as unknown as TaskStatus,
    history: (row.history ?? []) as Message[],
    metadata: { ...(row.metadata ?? {}), awaiting: row.awaiting ?? null, agent: row.agentSlug },
  };
  if (includeArtifacts) task.artifacts = (row.artifacts ?? []) as Artifact[];
  return withHistory(task, historyLength);
}

async function loadRow(taskId: string, app: AuthedApp): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new A2AError("TaskNotFoundError", undefined, { taskId });
  const [row] = await getDb()
    .select()
    .from(a2aTasks)
    .where(and(eq(a2aTasks.id, taskId), eq(a2aTasks.appId, app.id)))
    .limit(1);
  if (!row) throw new A2AError("TaskNotFoundError", undefined, { taskId });
  return row;
}

async function openTaskInContext(conversationId: string, app: AuthedApp): Promise<Row | null> {
  const [row] = await getDb()
    .select()
    .from(a2aTasks)
    .where(
      and(
        eq(a2aTasks.conversationId, conversationId),
        eq(a2aTasks.appId, app.id),
        inArray(a2aTasks.state, ["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"])
      )
    )
    .orderBy(desc(a2aTasks.updatedAt))
    .limit(1);
  return row ?? null;
}

async function contextBelongsToApp(conversationId: string, app: AuthedApp): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: a2aTasks.id })
    .from(a2aTasks)
    .where(and(eq(a2aTasks.conversationId, conversationId), eq(a2aTasks.appId, app.id)))
    .limit(1);
  return Boolean(row);
}

async function updateRow(id: string, patch: Partial<Row>): Promise<Row> {
  const [row] = await getDb()
    .update(a2aTasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(a2aTasks.id, id))
    .returning();
  return row!;
}

/**
 * Take the task for one turn. Only one turn runs at a time: a second message
 * while the first is in flight is refused rather than interleaved.
 */
async function acquire(id: string): Promise<Row> {
  const stale = new Date(Date.now() - STALE_WORKING_MS);
  const [row] = await getDb()
    .update(a2aTasks)
    .set({ state: "TASK_STATE_WORKING", updatedAt: new Date() })
    .where(and(eq(a2aTasks.id, id), or(ne(a2aTasks.state, "TASK_STATE_WORKING"), lt(a2aTasks.updatedAt, stale))))
    .returning();
  if (!row) throw new A2AError("UnsupportedOperationError", "the task is already being processed; wait for it to finish, then send the next message", { taskId: id });
  return row;
}

// ─── Running a turn of the engine ────────────────────────────────────────────

type EngineMode = { kind: "message"; text: string } | { kind: "pulse" } | { kind: "payment_settled" };

/**
 * What the widget's pay button says when the customer comes back from Emirates
 * Post's payment page (apps/web/app/embed/[agent]/Markdown.tsx, PAID_BACK). The
 * agent then calls the confirm tool. The internal checkout is different: there
 * the widget sends the engine's own payment-settled directive, which tells the
 * model to submit — and, for a journey that saves through Emirates Post, to
 * call the SAVE tool, which after a gateway payment would open a second order.
 * So the two paths are told apart by the case: an order on the gateway means
 * the customer's words; anything else means the directive.
 */
const PAID_BACK: Record<"en" | "ar", string> = {
  en: "I have completed the payment on the Emirates Post page. Please verify it and confirm my booking.",
  ar: "لقد أتممت الدفع على صفحة بريد الإمارات. يُرجى التحقق منه وتأكيد الحجز.",
};

async function settledMode(conversationId: string, locale: "en" | "ar"): Promise<EngineMode> {
  const c = await getCase(conversationId).catch(() => null);
  if (c?.state.gatewayPayment) return { kind: "message", text: PAID_BACK[locale] };
  return { kind: "payment_settled" };
}

interface TurnOutcome {
  text: string;
  blocks: ReplyBlock[];
  state: CaseState | null;
  authRequired: string | null;
  paymentInitiated: { reference: string; link?: string; amount: number; currency: string; provider?: string; method?: string } | null;
  submitted: string | null;
  escalation: string | null;
  error: string | null;
  httpError: string | null;
  expired: string | null;
}

async function runEngineTurn(input: {
  ctx: A2AContext;
  conversationId: string;
  locale: "en" | "ar";
  mode: EngineMode;
  uaePassToken?: string;
  onText?: (soFar: string) => void;
}): Promise<TurnOutcome> {
  const { ctx } = input;
  const body: Record<string, unknown> = {
    agentSlug: ctx.entry.dialogSlug,
    conversationId: input.conversationId,
    locale: input.locale,
    authenticated: false,
    userMessage: input.mode.kind === "message" ? input.mode.text : input.mode.kind === "pulse" ? "account_pulse" : "payment_settled",
    ...(input.mode.kind === "pulse" ? { pulse: true } : {}),
    ...(input.mode.kind === "payment_settled" ? { paymentSettled: true } : {}),
    ...(ctx.entry.sandbox ? { sandbox: true } : {}),
    ...(input.uaePassToken ? { uaePassToken: input.uaePassToken } : {}),
  };
  const headers = new Headers({ "content-type": "application/json", accept: "text/event-stream" });
  if (ctx.forwardedHost) headers.set("x-forwarded-host", ctx.forwardedHost);
  if (ctx.forwardedProto) headers.set("x-forwarded-proto", ctx.forwardedProto);
  const req = new NextRequest(new URL("/api/chat", ctx.origin), { method: "POST", headers, body: JSON.stringify(body) });

  const out: TurnOutcome = {
    text: "",
    blocks: [],
    state: null,
    authRequired: null,
    paymentInitiated: null,
    submitted: null,
    escalation: null,
    error: null,
    httpError: null,
    expired: null,
  };

  const res = await chatPost(req);
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    out.httpError = `engine answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`;
    return out;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let raw = "";
  const deadline = setTimeout(() => {
    out.error = out.error ?? "The agent took too long to answer.";
    void reader.cancel().catch(() => {});
  }, TURN_DEADLINE_MS);
  const handle = (ev: Record<string, unknown>) => {
    switch (ev.type) {
      case "text":
        raw += String(ev.delta ?? "");
        input.onText?.(raw);
        break;
      case "case":
        out.state = ev.state as CaseState;
        break;
      case "done":
        if (ev.state) out.state = ev.state as CaseState;
        break;
      case "auth_required":
        out.authRequired = String(ev.reason ?? "Sign-in is required to continue.");
        break;
      case "payment_initiated":
        out.paymentInitiated = {
          reference: String(ev.reference ?? ""),
          link: typeof ev.link === "string" ? ev.link : undefined,
          amount: Number(ev.amount ?? 0),
          currency: String(ev.currency ?? "AED"),
          provider: typeof ev.provider === "string" ? ev.provider : undefined,
          method: typeof ev.method === "string" ? ev.method : undefined,
        };
        break;
      case "submitted":
        out.submitted = String(ev.reference ?? "");
        break;
      case "escalation":
        out.escalation = String(ev.reference ?? "");
        break;
      case "error":
        out.error = String(ev.message ?? "The agent could not complete this turn.");
        break;
      case "session":
        if (ev.expired) out.expired = String(ev.expired);
        break;
      default:
        break;
    }
  };
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      out.error = out.error ?? `The agent's reply was interrupted (${e instanceof Error ? e.message : String(e)}).`;
      break;
    }
    const { done, value } = chunk;
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          handle(JSON.parse(line.slice(6)) as Record<string, unknown>);
        } catch {
          /* a malformed frame is skipped */
        }
      }
    }
  }
  clearTimeout(deadline);
  const parsed = parseReply(raw);
  out.text = parsed.text;
  out.blocks = parsed.blocks;
  return out;
}

// ─── Reading the case for the client ─────────────────────────────────────────

const RECEIPT_RE = /\/api\/receipt\/[A-Za-z0-9._%-]+/;

function absolute(url: string, origin: string): string {
  try {
    return new URL(url, origin).toString();
  } catch {
    return url;
  }
}

function caseSummary(state: CaseState | null) {
  if (!state) return null;
  const collected: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state.data ?? {})) if (!k.startsWith("__") && v !== "" && v !== null && v !== undefined) collected[k] = v;
  return {
    journey: state.journeyKey ?? null,
    step: state.currentStep ?? null,
    status: state.status,
    reference: state.referenceLabel ?? state.reference ?? null,
    collected,
    missing: state.readiness?.missing ?? [],
    documents: (state.documents ?? []).map((d) => ({ key: d.key, status: d.status })),
    payment: {
      status: state.payment?.status ?? "none",
      reference: state.gatewayPayment?.reference ?? state.payment?.reference ?? null,
      amount: state.gatewayPayment?.amount ?? state.payment?.amount ?? null,
      currency: state.payment?.currency ?? "AED",
    },
  };
}

function pendingPayment(state: CaseState | null): boolean {
  if (!state) return false;
  const gw = state.gatewayPayment;
  if (gw && !gw.paidAt) return true;
  return state.payment?.status === "initiated";
}

interface Decision {
  state: TaskState;
  awaiting: Awaiting | null;
  newArtifacts: Artifact[];
  text: string;
}

function decide(input: {
  ctx: A2AContext;
  row: Row;
  turn: TurnOutcome;
  signedInNow: boolean;
}): Decision {
  const { ctx, row, turn } = input;
  const state = turn.state;
  const artifacts: Artifact[] = [];
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const knownPaymentRef = typeof meta.paymentReference === "string" ? meta.paymentReference : null;

  // The engine itself answered with an error status: the agent is not
  // configured here. Nothing a retry would change, so the task fails.
  if (turn.httpError) {
    return { state: "TASK_STATE_FAILED", awaiting: null, newArtifacts: [], text: turn.httpError };
  }
  // The engine ran and the turn broke — a model timeout, a backend that did not
  // answer. The widget shows the customer the apology and lets them try again;
  // the task does the same: it stays open, waiting for input, and says why.
  if (turn.error && !turn.text) {
    return {
      state: "TASK_STATE_INPUT_REQUIRED",
      awaiting: "input",
      newArtifacts: [],
      text: `${turn.error} You can send the same message again.`,
    };
  }

  // A payment the client has to make. From the pay block, the internal
  // checkout event, or the case — whichever this turn produced.
  const pay = turn.blocks.find((b): b is Extract<ReplyBlock, { type: "pay" }> => b.type === "pay");
  const gw = state?.gatewayPayment;
  const paymentRef = turn.paymentInitiated?.reference ?? gw?.reference ?? state?.payment?.reference ?? null;
  const owes = pendingPayment(state) || Boolean(turn.paymentInitiated) || Boolean(pay);
  if (owes && paymentRef && paymentRef !== knownPaymentRef) {
    const url = turn.paymentInitiated?.link ?? pay?.url ?? gw?.url ?? state?.payment?.link ?? null;
    const amount = turn.paymentInitiated?.amount ?? gw?.amount ?? state?.payment?.amount ?? null;
    artifacts.push({
      artifactId: newId(),
      name: "payment-request",
      description: "A payment the customer must make before the request completes. Open `url` to pay; in the sandbox, POST to `sandbox.settleUrl` to settle it without a browser.",
      parts: [
        dataPart({
          reference: paymentRef,
          amount,
          currency: "AED",
          url: url ? absolute(url, ctx.origin) : null,
          provider: turn.paymentInitiated?.provider ?? (gw ? "emirates-post-gateway" : null),
          method: turn.paymentInitiated?.method ?? (state?.data?.payment_method as string | undefined) ?? null,
          ...(ctx.entry.sandbox
            ? {
                sandbox: {
                  settleUrl: `${ctx.origin}/a2a/${ctx.entry.key}/sandbox/payments/${encodeURIComponent(paymentRef)}/settle`,
                  note: "Sandbox only. No money moves; the order is marked paid and the task continues by itself.",
                },
              }
            : {}),
        }),
      ],
    });
  }

  if (turn.authRequired && !input.signedInNow) {
    return {
      state: "TASK_STATE_AUTH_REQUIRED",
      awaiting: "auth",
      newArtifacts: artifacts,
      text:
        turn.text ||
        "The customer must be signed in to continue. Send a message carrying the citizen identity (see the Agent Card's citizen-identity extension).",
    };
  }

  const outcome = state && (state.status === "submitted" || state.status === "escalated");
  const escalated = Boolean(turn.escalation) || state?.status === "escalated";
  if (escalated) {
    artifacts.push({
      artifactId: newId(),
      name: "escalation",
      description: "The request was handed to a person at Emirates Post, who will call the customer back.",
      parts: [dataPart({ reference: turn.escalation ?? state?.reference ?? null, journey: state?.journeyKey ?? null })],
    });
    return { state: "TASK_STATE_COMPLETED", awaiting: null, newArtifacts: artifacts, text: turn.text };
  }
  if (outcome && !pendingPayment(state)) {
    const receipt = RECEIPT_RE.exec(turn.text)?.[0] ?? null;
    artifacts.push({
      artifactId: newId(),
      name: "service-outcome",
      description: "The result of the service request: its reference with Emirates Post, what was collected, and the payment.",
      parts: [
        dataPart({
          journey: state!.journeyKey,
          reference: state!.referenceLabel ?? state!.reference ?? turn.submitted ?? null,
          orderNo: state!.gatewayPayment?.orderNo ?? null,
          receiptUrl: receipt ? absolute(receipt, ctx.origin) : null,
          payment: caseSummary(state)!.payment,
          collected: caseSummary(state)!.collected,
        }),
      ],
    });
    return { state: "TASK_STATE_COMPLETED", awaiting: null, newArtifacts: artifacts, text: turn.text };
  }

  const awaiting: Awaiting = owes && paymentRef ? "payment" : "input";
  return { state: "TASK_STATE_INPUT_REQUIRED", awaiting, newArtifacts: artifacts, text: turn.text };
}

// ─── The operations ──────────────────────────────────────────────────────────

const localeOf = (metadata: Record<string, unknown> | undefined, text: string): "en" | "ar" => {
  const asked = String(metadata?.locale ?? "").toLowerCase();
  if (asked === "ar" || asked === "en") return asked;
  return /[؀-ۿ]/.test(text) ? "ar" : "en";
};

export interface SendOptions {
  /** Receive stream events as they happen (SendStreamingMessage). */
  onEvent?: (ev: StreamResponse) => void;
}

/**
 * SendMessage. Resolves or creates the task, applies the citizen identity,
 * runs one turn of the engine, and returns the task as it stands afterwards —
 * or, with `returnImmediately`, as soon as the turn has started.
 */
export async function sendMessage(ctx: A2AContext, params: SendMessageRequest, opts: SendOptions = {}): Promise<Task> {
  if (!params || typeof params !== "object" || !("message" in params)) throw new A2AError("InvalidParamsError", "params.message is required");
  const msg = validateInboundMessage(params.message);
  const text = messageText(msg);
  const identity = citizenIdentityIn(msg.metadata) ?? citizenIdentityIn(params.metadata);
  const returnImmediately = Boolean(params.configuration?.returnImmediately);
  const historyLength = params.configuration?.historyLength;

  const agent = await getAgentBySlug(ctx.entry.dialogSlug);
  if (!agent) throw new A2AError("InternalError", `the agent "${ctx.entry.key}" is not configured on this environment`);

  // Which task, which conversation.
  let row: Row | null = null;
  let conversationId: string;
  if (msg.taskId) {
    row = await loadRow(msg.taskId, ctx.app);
    if (msg.contextId && msg.contextId !== row.conversationId) {
      throw new A2AError("InvalidParamsError", "message.contextId does not match the task's contextId", { taskId: row.id, contextId: row.conversationId });
    }
    if (isTerminal(row.state as TaskState)) {
      throw new A2AError("UnsupportedOperationError", `the task is ${row.state}; start a new task in the same contextId instead`, { taskId: row.id, state: row.state });
    }
    conversationId = row.conversationId;
  } else if (msg.contextId) {
    if (!/^[0-9a-f-]{36}$/i.test(msg.contextId) || !(await contextBelongsToApp(msg.contextId, ctx.app))) {
      throw new A2AError("InvalidParamsError", "unknown contextId; omit it to start a new conversation", { contextId: msg.contextId });
    }
    conversationId = msg.contextId;
    row = await openTaskInContext(conversationId, ctx.app);
  } else {
    const session = await getOrCreateSession({ agentId: agent.id, locale: localeOf(msg.metadata, text), authenticated: false });
    conversationId = session.conversationId;
  }

  // The engine's own view of the conversation: is it signed in, where is the case.
  const session = await getOrCreateSession({ agentId: agent.id, conversationId, locale: localeOf(msg.metadata, text), authenticated: false });
  if (session.conversationId !== conversationId) {
    throw new A2AError("InvalidParamsError", "the conversation behind this contextId no longer exists", { contextId: conversationId });
  }

  const applied = await applyCitizenIdentity({
    entry: ctx.entry,
    conversationId,
    caseId: session.caseId,
    alreadyAuthenticated: session.authenticated,
    identity,
  });

  // What to run. A settled sandbox payment on a task waiting for one is
  // acknowledged the way the widget does it: with the engine's own directive,
  // not a sentence put in the customer's mouth. A sign-in with nothing else
  // said gets the account pulse, as it does after the UAE PASS popup closes.
  let mode: EngineMode;
  const paidNow = row?.awaiting === "payment" && (await sandboxPaymentPaid(conversationId, row));
  if (paidNow) mode = await settledMode(conversationId, localeOf(msg.metadata, text));
  else if (applied.signedIn && !text) mode = { kind: "pulse" };
  else if (!text) throw new A2AError("InvalidParamsError", "the message has no text; send what the customer said");
  else mode = { kind: "message", text };

  const userMessage: Message = { ...msg, contextId: conversationId, role: "ROLE_USER" };

  if (!row) {
    const [created] = await getDb()
      .insert(a2aTasks)
      .values({
        agentId: agent.id,
        agentSlug: ctx.entry.key,
        appId: ctx.app.id,
        conversationId,
        caseId: session.caseId,
        state: "TASK_STATE_SUBMITTED",
        status: mkStatus("TASK_STATE_SUBMITTED") as unknown as Record<string, unknown>,
        artifacts: [],
        history: [],
        metadata: { ...(applied.persona ? { persona: applied.persona } : {}), locale: localeOf(msg.metadata, text) },
        awaiting: null,
      })
      .returning();
    row = created!;
  }
  userMessage.taskId = row.id;

  // Lock, record the message, announce WORKING.
  row = await acquire(row.id);
  const history = [...((row.history ?? []) as Message[]), userMessage];
  const workingStatus = mkStatus("TASK_STATE_WORKING");
  row = await updateRow(row.id, {
    history,
    status: workingStatus as unknown as Record<string, unknown>,
    metadata: { ...(row.metadata ?? {}), ...(applied.persona ? { persona: applied.persona } : {}) },
  });
  const snapshot = rowToTask(row, historyLength);
  opts.onEvent?.({ task: snapshot });
  publish(row.id, { statusUpdate: { taskId: row.id, contextId: conversationId, status: workingStatus } });

  const run = async (): Promise<Task> => {
    let partialAt = 0;
    const turn = await runEngineTurn({
      ctx,
      conversationId,
      locale: ((row!.metadata as Record<string, unknown>)?.locale as "en" | "ar") ?? localeOf(msg.metadata, text),
      mode,
      uaePassToken: applied.uaePassToken,
      onText: (soFar) => {
        const now = Date.now();
        if (now - partialAt < 700) return;
        partialAt = now;
        const partial = agentMessage([textPart(parseReply(soFar).text)], { contextId: conversationId, taskId: row!.id }, { partial: true });
        const ev: StreamResponse = { statusUpdate: { taskId: row!.id, contextId: conversationId, status: mkStatus("TASK_STATE_WORKING", partial) } };
        opts.onEvent?.(ev);
        publish(row!.id, ev);
      },
    });
    // The persisted case is the truth; the stream's last `case` event is not.
    const persisted = await getCase(conversationId).catch(() => null);
    if (persisted) turn.state = persisted.state;
    return finishTurn(ctx, row!, turn, applied.signedIn, opts.onEvent, historyLength);
  };

  if (returnImmediately) {
    void run().catch((e) => log.error("a2a_turn_failed", e, { taskId: row!.id }));
    return snapshot;
  }
  return run();
}

async function finishTurn(
  ctx: A2AContext,
  row: Row,
  turn: TurnOutcome,
  signedInNow: boolean,
  onEvent: ((ev: StreamResponse) => void) | undefined,
  historyLength: number | undefined
): Promise<Task> {
  const decision = decide({ ctx, row, turn, signedInNow });
  const summary = caseSummary(turn.state);
  const reply = agentMessage(
    [
      textPart(decision.text),
      dataPart({
        blocks: turn.blocks,
        case: summary,
        awaiting: decision.awaiting,
        ...(turn.error ? { warning: turn.error } : {}),
        ...(turn.expired ? { sessionExpired: turn.expired } : {}),
      }),
    ],
    { contextId: row.conversationId, taskId: row.id }
  );
  reply.extensions = [DIALOG_REPLY_EXTENSION];
  const status = mkStatus(decision.state, reply);
  const meta = { ...(row.metadata ?? {}) } as Record<string, unknown>;
  const payArtifact = decision.newArtifacts.find((a) => a.name === "payment-request");
  if (payArtifact) {
    const data = payArtifact.parts[0]?.data as Record<string, unknown> | undefined;
    if (data?.reference) meta.paymentReference = data.reference;
  }
  if (summary?.journey) meta.journey = summary.journey;
  const updated = await updateRow(row.id, {
    state: decision.state,
    status: status as unknown as Record<string, unknown>,
    artifacts: [...((row.artifacts ?? []) as Artifact[]), ...decision.newArtifacts],
    history: [...((row.history ?? []) as Message[]), reply],
    awaiting: decision.awaiting,
    metadata: meta,
  });
  for (const artifact of decision.newArtifacts) {
    const ev: StreamResponse = { artifactUpdate: { taskId: row.id, contextId: row.conversationId, artifact, lastChunk: true } };
    onEvent?.(ev);
    publish(row.id, ev);
  }
  const ev: StreamResponse = { statusUpdate: { taskId: row.id, contextId: row.conversationId, status } };
  onEvent?.(ev);
  publish(row.id, ev);
  return rowToTask(updated, historyLength);
}

/** Has the payment this task is waiting for been made? */
async function sandboxPaymentPaid(conversationId: string, row: Row): Promise<boolean> {
  const ref = (row.metadata as Record<string, unknown> | null)?.paymentReference;
  const db = getDb();
  const rows =
    typeof ref === "string" && ref
      ? await db.select({ status: payments.status }).from(payments).where(eq(payments.reference, ref)).limit(1)
      : await db
          .select({ status: payments.status })
          .from(payments)
          .where(eq(payments.conversationId, conversationId))
          .orderBy(desc(payments.createdAt))
          .limit(1);
  if (rows[0]?.status === "paid") return true;
  const c = await getCase(conversationId).catch(() => null);
  return c?.state.payment?.status === "paid" && !(c.state.gatewayPayment && !c.state.gatewayPayment.paidAt);
}

export async function getTask(ctx: A2AContext, params: { id: string; historyLength?: number }): Promise<Task> {
  if (!params?.id) throw new A2AError("InvalidParamsError", "params.id is required");
  const row = await loadRow(params.id, ctx.app);
  return rowToTask(row, params.historyLength);
}

export async function listTasks(ctx: A2AContext, params: ListTasksRequest = {}): Promise<ListTasksResponse> {
  const pageSize = Math.min(Math.max(Number(params.pageSize ?? 20) || 20, 1), 100);
  const where = [eq(a2aTasks.appId, ctx.app.id), eq(a2aTasks.agentSlug, ctx.entry.key)];
  if (params.contextId) where.push(eq(a2aTasks.conversationId, params.contextId));
  if (params.status) where.push(eq(a2aTasks.state, params.status));
  if (params.statusTimestampAfter) {
    const t = new Date(params.statusTimestampAfter);
    if (!Number.isNaN(t.getTime())) where.push(sql`${a2aTasks.updatedAt} > ${t.toISOString()}`);
  }
  if (params.pageToken) {
    try {
      const [at, id] = Buffer.from(params.pageToken, "base64url").toString("utf8").split("|");
      if (!at || !id) throw new Error("token");
      where.push(or(lt(a2aTasks.updatedAt, new Date(at)), and(eq(a2aTasks.updatedAt, new Date(at)), lt(a2aTasks.id, id)))!);
    } catch {
      throw new A2AError("InvalidParamsError", "pageToken is not one this agent issued");
    }
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(a2aTasks)
    .where(and(...where))
    .orderBy(desc(a2aTasks.updatedAt), desc(a2aTasks.id))
    .limit(pageSize + 1);
  const counted = await db
    .select({ n: sql<number>`count(*)` })
    .from(a2aTasks)
    .where(and(...where.slice(0, params.pageToken ? -1 : undefined)));
  const n = counted[0]?.n ?? 0;
  const page = rows.slice(0, pageSize);
  const last = rows.length > pageSize ? page[page.length - 1] : null;
  return {
    tasks: page.map((r) => rowToTask(r, params.historyLength ?? 0, Boolean(params.includeArtifacts))),
    nextPageToken: last ? Buffer.from(`${last.updatedAt.toISOString()}|${last.id}`, "utf8").toString("base64url") : "",
    pageSize,
    totalSize: Number(n),
  };
}

export async function cancelTask(ctx: A2AContext, params: { id: string }): Promise<Task> {
  if (!params?.id) throw new A2AError("InvalidParamsError", "params.id is required");
  const row = await loadRow(params.id, ctx.app);
  if (isTerminal(row.state as TaskState)) throw new A2AError("TaskNotCancelableError", `the task is already ${row.state}`, { taskId: row.id });
  const note = agentMessage([textPart("The task was canceled by the client. The conversation stays open; a new task may be started in the same contextId.")], {
    contextId: row.conversationId,
    taskId: row.id,
  });
  const status = mkStatus("TASK_STATE_CANCELED", note);
  const updated = await updateRow(row.id, {
    state: "TASK_STATE_CANCELED",
    status: status as unknown as Record<string, unknown>,
    history: [...((row.history ?? []) as Message[]), note],
    awaiting: null,
  });
  publish(row.id, { statusUpdate: { taskId: row.id, contextId: row.conversationId, status } });
  return rowToTask(updated);
}

/**
 * SubscribeToTask. The current task first, then every event until the task
 * leaves WORKING, or until `maxWaitMs` passes for a task that is waiting on the
 * client (a payment, say) — the stream then closes and the client may
 * subscribe again.
 */
export async function* subscribeToTask(ctx: A2AContext, params: { id: string }, maxWaitMs = 55_000): AsyncGenerator<StreamResponse> {
  if (!params?.id) throw new A2AError("InvalidParamsError", "params.id is required");
  const row = await loadRow(params.id, ctx.app);
  if (isTerminal(row.state as TaskState)) throw new A2AError("UnsupportedOperationError", `the task is ${row.state}; nothing more will happen on it`, { taskId: row.id });
  yield { task: rowToTask(row) };

  const queue: StreamResponse[] = [];
  let wake: (() => void) | null = null;
  const unsubscribe = subscribe(row.id, (ev) => {
    queue.push(ev);
    wake?.();
  });
  const deadline = Date.now() + maxWaitMs;
  try {
    for (;;) {
      while (queue.length) {
        const ev = queue.shift()!;
        yield ev;
        if ("statusUpdate" in ev) {
          const s = ev.statusUpdate.status.state;
          if (isTerminal(s) || s === "TASK_STATE_INPUT_REQUIRED" || s === "TASK_STATE_AUTH_REQUIRED") return;
        }
      }
      const left = deadline - Date.now();
      if (left <= 0) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, Math.min(left, 15_000));
      });
      wake = null;
    }
  } finally {
    unsubscribe();
  }
}

/**
 * A payment settled — the webhook saw it. Any task waiting for that payment is
 * moved on by itself: the engine runs its payment-settled turn, the task goes
 * WORKING and then COMPLETED (or asks for whatever is still missing), and a
 * subscribed client sees every step.
 */
export async function onPaymentSettled(conversationId: string, origin?: string): Promise<void> {
  const rows = await getDb()
    .select()
    .from(a2aTasks)
    .where(and(eq(a2aTasks.conversationId, conversationId), eq(a2aTasks.awaiting, "payment")))
    .orderBy(asc(a2aTasks.updatedAt));
  for (const row of rows) {
    const { agentEntry } = await import("./catalogue");
    const entry = agentEntry(row.agentSlug);
    if (!entry) continue;
    const { getDb: db, developerApps } = await import("@dialog/db");
    const [app] = await db().select().from(developerApps).where(eq(developerApps.id, row.appId)).limit(1);
    if (!app) continue;
    const ctx: A2AContext = {
      entry,
      app: { id: app.id, accountId: app.accountId, name: app.name, clientId: app.clientId, agentSlugs: app.agentSlugs ?? [], scopes: app.scopes ?? [], via: "bearer" },
      origin: origin ?? process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_DIALOG_HOST ?? "http://localhost:3000",
    };
    try {
      const locked = await acquire(row.id);
      const working = mkStatus("TASK_STATE_WORKING");
      const current = await updateRow(locked.id, { status: working as unknown as Record<string, unknown> });
      publish(row.id, { statusUpdate: { taskId: row.id, contextId: conversationId, status: working } });
      const locale = ((current.metadata as Record<string, unknown>)?.locale as "en" | "ar") ?? "en";
      const turn = await runEngineTurn({ ctx, conversationId, locale, mode: await settledMode(conversationId, locale) });
      const persisted = await getCase(conversationId).catch(() => null);
      if (persisted) turn.state = persisted.state;
      await finishTurn(ctx, current, turn, false, undefined, undefined);
    } catch (e) {
      log.error("a2a_payment_settled_turn_failed", e, { taskId: row.id });
    }
  }
}

export { nowIso };
