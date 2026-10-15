/**
 * The JSON-RPC 2.0 binding of A2A (specification §9) for one agent.
 *
 *   GET  /a2a/{agent}   → the Agent Card
 *   POST /a2a/{agent}   → { jsonrpc, id, method, params }
 *
 * Streaming methods answer with text/event-stream, each event a complete
 * JSON-RPC response whose result is a StreamResponse. Service parameters travel
 * as headers: A2A-Version, A2A-Extensions.
 */
import { A2AError, sseJsonRpc, type JsonRpcId } from "@dialog/core";
import { asA2AError, contextFor, entryOr404, jsonResponse, jsonRpcError, originOf, recordRequest, sseResponse } from "@/lib/a2a/http";
import { buildAgentCard } from "@/lib/a2a/catalogue";
import { handleStream, handleUnary, STREAMING_OPERATIONS } from "@/lib/a2a/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ agent: string }> };

export async function GET(req: Request, { params }: Params) {
  const { agent } = await params;
  try {
    const entry = entryOr404(agent);
    const card = buildAgentCard(entry, originOf(req).origin);
    return jsonResponse(card, 200, { "cache-control": "public, max-age=300", etag: `"${entry.key}-${entry.version}"` });
  } catch (e) {
    return jsonRpcError(null, asA2AError(e, "card"));
  }
}

export async function POST(req: Request, { params }: Params) {
  const start = Date.now();
  const { agent } = await params;
  let id: JsonRpcId = null;
  let method = "";
  let appId: string | null = null;
  const fail = (err: A2AError) => {
    recordRequest(start, { appId, agentSlug: agent, method: method || "(invalid)", binding: "jsonrpc", ok: false, errorCode: err.code, httpStatus: err.http });
    return jsonRpcError(id, err);
  };
  try {
    const entry = entryOr404(agent);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new A2AError("JSONParseError");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new A2AError("InvalidRequestError", "batch requests are not supported");
    const rpc = body as Record<string, unknown>;
    if (rpc.jsonrpc !== "2.0") throw new A2AError("InvalidRequestError", 'jsonrpc must be "2.0"');
    if (typeof rpc.method !== "string" || !rpc.method) throw new A2AError("InvalidRequestError", "method is required");
    if (rpc.id !== undefined && rpc.id !== null && typeof rpc.id !== "string" && typeof rpc.id !== "number") throw new A2AError("InvalidRequestError", "id must be a string, a number or null");
    id = (rpc.id as JsonRpcId) ?? null;
    method = rpc.method;
    const rpcParams = rpc.params;

    const ctx = await contextFor(req, entry);
    appId = ctx.app.id;

    if (STREAMING_OPERATIONS.has(method)) {
      const events = handleStream(ctx, method, rpcParams);
      return sseResponse(
        events,
        (ev) => sseJsonRpc(id, ev),
        (err) => `data: ${JSON.stringify({ jsonrpc: "2.0", id, error: err.toJsonRpc() })}\n\n`,
        (ok, err) => recordRequest(start, { appId, agentSlug: agent, method, binding: "jsonrpc", ok, errorCode: err?.code ?? null, httpStatus: 200 })
      );
    }
    const result = await handleUnary(ctx, method, rpcParams);
    const taskId = result && typeof result === "object" && "task" in (result as Record<string, unknown>) ? ((result as { task?: { id?: string } }).task?.id ?? null) : (result as { id?: string })?.id ?? null;
    recordRequest(start, { appId, agentSlug: agent, taskId, method, binding: "jsonrpc", ok: true, httpStatus: 200 });
    return jsonResponse({ jsonrpc: "2.0", id, result });
  } catch (e) {
    return fail(asA2AError(e, `jsonrpc:${method}`));
  }
}
