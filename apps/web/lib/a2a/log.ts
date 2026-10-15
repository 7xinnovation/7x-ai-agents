/** One line per call on the doorway, for the developer's own request log. Best-effort. */
import { getDb, a2aRequests } from "@dialog/db";

export interface RequestLogEntry {
  appId?: string | null;
  agentSlug?: string | null;
  taskId?: string | null;
  method: string;
  binding: "jsonrpc" | "rest" | "oauth" | "sandbox";
  ok: boolean;
  errorCode?: number | null;
  httpStatus: number;
  latencyMs: number;
}

export function logRequest(entry: RequestLogEntry): void {
  void getDb()
    .insert(a2aRequests)
    .values({
      appId: entry.appId ?? null,
      agentSlug: entry.agentSlug ?? null,
      taskId: entry.taskId && /^[0-9a-f-]{36}$/i.test(entry.taskId) ? entry.taskId : null,
      method: entry.method.slice(0, 80),
      binding: entry.binding,
      ok: entry.ok,
      errorCode: entry.errorCode ?? null,
      httpStatus: entry.httpStatus,
      latencyMs: Math.max(0, Math.round(entry.latencyMs)),
    })
    .catch(() => {});
}
