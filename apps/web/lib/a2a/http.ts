/**
 * The HTTP side of the doorway, shared by the JSON-RPC and REST routes: the
 * public origin, authenticating and scoping a request to an agent, turning an
 * error into the binding's error shape, and framing a stream as SSE.
 */
import { A2AError, type A2AErrorName, type JsonRpcId, type StreamResponse } from "@dialog/core";
import { agentEntry, type A2AAgentEntry } from "./catalogue";
import { assertMayCall, authenticateRequest } from "./auth";
import type { A2AContext } from "./tasks";
import { logRequest, type RequestLogEntry } from "./log";
import { log } from "@/lib/logger";
import { getSettings } from "@/lib/developer/settings";

/** Calls per application in the current minute, per process. */
const windows = new Map<string, { minute: number; count: number }>();
function overLimit(appId: string, limit: number): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const w = windows.get(appId);
  if (!w || w.minute !== minute) {
    windows.set(appId, { minute, count: 1 });
    return false;
  }
  w.count += 1;
  return w.count > limit;
}

/** The origin the client reached, honouring a proxy only when it agrees with the host that answered. */
export function originOf(req: Request): { origin: string; host?: string; proto?: string } {
  const pin = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_DIALOG_HOST;
  if (pin && /^https?:\/\//i.test(pin)) {
    try {
      const u = new URL(pin);
      return { origin: u.origin, host: u.host, proto: u.protocol.replace(/:$/, "") };
    } catch {
      /* fall through */
    }
  }
  const url = new URL(req.url);
  const arrived = req.headers.get("host")?.trim();
  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded && (!arrived || forwarded === arrived) ? forwarded : arrived || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "");
  return { origin: `${proto}://${host}`, host, proto };
}

/** The agent an URL names, or a not-found error in the binding's shape. */
export function entryOr404(key: string | undefined): A2AAgentEntry {
  const entry = agentEntry(key);
  if (!entry) throw new A2AError("MethodNotFoundError", `no agent "${key ?? ""}" on this host`);
  return entry;
}

/** Authenticate the application and scope it to the agent. */
export async function contextFor(req: Request, entry: A2AAgentEntry): Promise<A2AContext> {
  const version = req.headers.get("a2a-version")?.trim();
  if (version && !/^(1\.0|0\.3)$/.test(version)) {
    throw new A2AError("VersionNotSupportedError", `this agent speaks A2A 1.0; the request declared ${version}`, { supported: ["1.0"] });
  }
  const settings = await getSettings();
  if (!settings.doorwayEnabled) throw new A2AError("UnavailableError", "the sandbox is paused by 7X; try again later");
  const app = await authenticateRequest(req);
  assertMayCall(app, entry.key);
  if (settings.rateLimitPerMinute > 0 && overLimit(app.id, settings.rateLimitPerMinute)) {
    throw new A2AError("RateLimitedError", `more than ${settings.rateLimitPerMinute} calls a minute from this application`, { limitPerMinute: settings.rateLimitPerMinute });
  }
  const { origin, host, proto } = originOf(req);
  return { entry, app, origin, forwardedHost: host, forwardedProto: proto };
}

export const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

/** Any thrown value as an A2A error: ours as they are, anything else as InternalError, logged. */
export function asA2AError(e: unknown, where: string): A2AError {
  if (e instanceof A2AError) return e;
  const described =
    e instanceof Error
      ? e
      : new Error(
          typeof e === "object" && e
            ? `${(e as { constructor?: { name?: string } }).constructor?.name ?? "object"}: ${(e as { message?: string }).message ?? (e as { type?: string }).type ?? JSON.stringify(e).slice(0, 200)}`
            : String(e)
        );
  log.error("a2a_internal_error", described, { where });
  return new A2AError("InternalError");
}

export function jsonRpcError(id: JsonRpcId, err: A2AError): Response {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (err.name === "UnauthenticatedError") headers["www-authenticate"] = 'Bearer realm="a2a", error="invalid_token"';
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: err.toJsonRpc() }), { status: err.http, headers });
}

export function restError(err: A2AError): Response {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (err.name === "UnauthenticatedError") headers["www-authenticate"] = 'Bearer realm="a2a", error="invalid_token"';
  return new Response(JSON.stringify({ error: { code: err.code, status: err.name.replace(/Error$/, ""), message: err.message, details: err.details } }), {
    status: err.http,
    headers,
  });
}

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/**
 * Server-Sent Events from an async iterator. `frame` turns one StreamResponse
 * into one `data:` line (JSON-RPC wraps it in a response envelope, REST does
 * not). An error after the stream has opened is sent as a final frame built by
 * `frameError`, because the status line has already gone.
 */
export function sseResponse(
  events: AsyncGenerator<StreamResponse>,
  frame: (ev: StreamResponse) => string,
  frameError: (err: A2AError) => string,
  onClose?: (ok: boolean, err?: A2AError) => void
): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          clearInterval(ping);
        }
      }, 15_000);
      let ok = true;
      let failure: A2AError | undefined;
      try {
        for await (const ev of events) controller.enqueue(enc.encode(frame(ev)));
      } catch (e) {
        ok = false;
        failure = asA2AError(e, "sse");
        try {
          controller.enqueue(enc.encode(frameError(failure)));
        } catch {
          /* closed */
        }
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* closed */
        }
        onClose?.(ok, failure);
      }
    },
    cancel() {
      void events.return(undefined);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}

/** Record the call once it is answered. */
export function recordRequest(start: number, entry: Omit<RequestLogEntry, "latencyMs">): void {
  logRequest({ ...entry, latencyMs: Date.now() - start });
}

export const errorName = (name: A2AErrorName): string => name;
