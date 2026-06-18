/**
 * Minimal structured logger (PRD NFR: structured logging with correlation IDs).
 * Emits one JSON line per event to stdout/stderr — parseable by any log
 * aggregator (Datadog, CloudWatch, Loki) without a heavy dependency. Use
 * correlation fields (conversationId, agentId, reference) so events can be traced.
 */
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, err?: unknown, fields?: Record<string, unknown>) =>
    emit("error", msg, { ...fields, error: err instanceof Error ? err.message : String(err ?? "") }),
};
