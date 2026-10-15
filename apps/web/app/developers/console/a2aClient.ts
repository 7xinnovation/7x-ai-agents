/**
 * The Console's A2A client: same-origin fetches to the JSON-RPC binding with
 * the application's bearer token, and a reader for the SSE frames the
 * streaming methods answer with. Nothing here is specific to the sandbox agent.
 */
import type { JsonRpcId } from "@dialog/core";
import type { RpcErrorShape } from "./types";

export interface RpcAuth {
  agentKey: string;
  token: string;
}

export interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export type RpcFrame = { jsonrpc: "2.0"; id: JsonRpcId; result: unknown } | { jsonrpc: "2.0"; id: JsonRpcId; error: RpcErrorShape };

const baseHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  "A2A-Version": "1.0",
  "Content-Type": "application/json",
});

const localError = (id: JsonRpcId, message: string, code = -32603): RpcFrame => ({ jsonrpc: "2.0", id, error: { code, message } });

/** One unary call. The HTTP status is returned alongside; the frame is always a JSON-RPC response. */
export async function rpcUnary(auth: RpcAuth, body: RpcRequest): Promise<{ frame: RpcFrame; http: number }> {
  const res = await fetch(`/a2a/${auth.agentKey}`, {
    method: "POST",
    headers: { ...baseHeaders(auth.token), Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let frame: RpcFrame;
  try {
    frame = JSON.parse(text) as RpcFrame;
  } catch {
    frame = localError(body.id, `The server answered ${res.status} without a JSON body`);
  }
  return { frame, http: res.status };
}

/**
 * One streaming call. Every `data:` line is a complete JSON-RPC response and is
 * handed to `onFrame` in order. An error before the stream opens (a 401, a bad
 * version) arrives as a plain JSON response and is handed over the same way.
 */
export async function rpcStream(auth: RpcAuth, body: RpcRequest, onFrame: (frame: RpcFrame) => void): Promise<{ http: number }> {
  const res = await fetch(`/a2a/${auth.agentKey}`, {
    method: "POST",
    headers: { ...baseHeaders(auth.token), Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream") || !res.body) {
    const text = await res.text();
    try {
      onFrame(JSON.parse(text) as RpcFrame);
    } catch {
      onFrame(localError(body.id, `The server answered ${res.status} without a JSON body`));
    }
    return { http: res.status };
  }
  await readSse(res.body, (json) => onFrame(json as RpcFrame));
  return { http: res.status };
}

/** Parse a text/event-stream body; comment lines (": ping") are skipped. */
async function readSse(body: ReadableStream<Uint8Array>, onData: (json: unknown) => void): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const emit = (frame: string) => {
    const data = frame
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("\n");
    if (!data) return;
    try {
      onData(JSON.parse(data));
    } catch {
      /* a malformed frame is skipped */
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      emit(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  if (buf.trim()) emit(buf);
}

/**
 * An absolute URL the doorway handed out, as a same-origin path. The Console
 * runs on the doorway's own origin, so the path is enough; it also keeps the
 * call same-origin when the server's public origin is pinned to another host.
 */
export function sameOriginPath(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** The sandbox's settle endpoint: the same bearer, a one-word body. */
export async function settleSandboxPayment(
  token: string,
  settleUrl: string,
  outcome: "paid" | "failed"
): Promise<{ ok: boolean; http: number; body: unknown }> {
  const res = await fetch(sameOriginPath(settleUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ outcome }),
  });
  const body: unknown = await res.json().catch(() => null);
  return { ok: res.ok, http: res.status, body };
}
