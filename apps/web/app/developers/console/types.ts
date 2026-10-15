/**
 * What the Console passes between its pieces: the props the server page hands
 * over, the transcript it keeps, and small readers for the task objects the
 * doorway returns. Types only from the protocol package, so nothing of the
 * server reaches the browser bundle.
 */
import type { Artifact, Message, Task, TaskState } from "@dialog/core";
import type { ReplyBlock } from "@/lib/a2a/blocks";

export interface ConsoleApp {
  id: string;
  name: string;
  clientId: string;
  apiKeyHint: string;
  agentSlugs: string[];
}

export interface ConsolePersona {
  id: string;
  label: string;
  description: string;
  signedIn: boolean;
}

export interface ConsoleAgent {
  key: string;
  name: string;
  version: string;
}

export type Awaiting = "input" | "auth" | "payment" | null;

/** The `case` object inside every agent message's data part. */
export interface CaseSummary {
  journey: string | null;
  step: string | null;
  status: string;
  reference: string | null;
  collected: Record<string, unknown>;
  missing: { key: string; kind: "field" | "document" }[];
  documents: { key: string; status: string }[];
  payment: { status: string; reference: string | null; amount: number | null; currency: string };
}

/** The data part of an agent message (the dialog-reply extension). */
export interface ReplyData {
  blocks?: ReplyBlock[];
  case?: CaseSummary | null;
  awaiting?: Awaiting;
  warning?: string;
  sessionExpired?: string;
}

/** The data part of a `payment-request` artifact. */
export interface PaymentRequestData {
  reference: string | null;
  amount: number | null;
  currency: string;
  url: string | null;
  provider: string | null;
  method: string | null;
  sandbox?: { settleUrl: string; note: string };
}

export type TranscriptEntry =
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "agent"; id: string; messageId: string; text: string; data: ReplyData | null; state: TaskState; at: string }
  | { kind: "note"; id: string; text: string; tone: "muted" | "error" | "ok"; at: string }
  | { kind: "divider"; id: string; text: string };

export interface RpcErrorShape {
  code: number;
  message: string;
  data?: unknown[];
}

export interface RawExchange {
  label: string;
  request: unknown;
  response: unknown;
  at: string;
}

const TERMINAL: ReadonlySet<string> = new Set(["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"]);

export const isTerminalState = (s: TaskState | string | undefined | null): boolean => Boolean(s && TERMINAL.has(s));

export function messageTextOf(m: Message | undefined | null): string {
  if (!m) return "";
  return m.parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function replyDataOf(m: Message | undefined | null): ReplyData | null {
  const d = m?.parts.find((p) => p.data !== undefined)?.data;
  return d && typeof d === "object" ? (d as ReplyData) : null;
}

export function awaitingOf(task: Task | null | undefined): Awaiting {
  const a = task?.metadata?.awaiting;
  return a === "input" || a === "auth" || a === "payment" ? a : null;
}

export function artifactData<T = unknown>(a: Artifact): T | null {
  const d = a.parts.find((p) => p.data !== undefined)?.data;
  return d && typeof d === "object" ? (d as T) : null;
}

/** The payment-request artifacts of a task, oldest first. */
export function paymentRequests(task: Task | null | undefined): { artifact: Artifact; data: PaymentRequestData }[] {
  return (task?.artifacts ?? [])
    .filter((a) => a.name === "payment-request")
    .map((artifact) => ({ artifact, data: artifactData<PaymentRequestData>(artifact) }))
    .filter((x): x is { artifact: Artifact; data: PaymentRequestData } => Boolean(x.data));
}

/** The payment the task is waiting for right now, if any. */
export function currentPayment(task: Task | null | undefined): { artifact: Artifact; data: PaymentRequestData } | null {
  if (!task || awaitingOf(task) !== "payment") return null;
  const list = paymentRequests(task);
  if (!list.length) return null;
  const wanted = typeof task.metadata?.paymentReference === "string" ? task.metadata.paymentReference : null;
  return list.find((p) => wanted && p.data.reference === wanted) ?? list[list.length - 1] ?? null;
}

export function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // A fallback for an insecure context, where randomUUID is absent.
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const STATE_LABEL: Record<string, string> = {
  TASK_STATE_SUBMITTED: "Submitted",
  TASK_STATE_WORKING: "Working",
  TASK_STATE_INPUT_REQUIRED: "Input required",
  TASK_STATE_AUTH_REQUIRED: "Sign-in required",
  TASK_STATE_COMPLETED: "Completed",
  TASK_STATE_FAILED: "Failed",
  TASK_STATE_CANCELED: "Canceled",
  TASK_STATE_REJECTED: "Rejected",
  TASK_STATE_UNSPECIFIED: "Unspecified",
};
