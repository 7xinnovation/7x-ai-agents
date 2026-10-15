/**
 * Everything under /a2a/{agent}/… other than the JSON-RPC endpoint itself:
 *
 *   GET  /a2a/{agent}/agent-card.json                 the Agent Card
 *
 *   The HTTP+JSON binding (specification §11), base /a2a/{agent}/rest:
 *   POST /rest/message:send           GET  /rest/tasks           GET  /rest/tasks/{id}
 *   POST /rest/message:stream (SSE)   POST /rest/tasks/{id}:cancel
 *   POST /rest/tasks/{id}:subscribe (SSE)              GET  /rest/extendedAgentCard
 *
 *   Sandbox conveniences, outside the protocol:
 *   GET  /a2a/{agent}/sandbox/personas
 *   POST /a2a/{agent}/sandbox/payments/{reference}/settle   { outcome?: "paid" | "failed" }
 */
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { A2AError, sseRest, type ListTasksRequest } from "@dialog/core";
import { asA2AError, contextFor, entryOr404, jsonResponse, originOf, recordRequest, restError, sseResponse } from "@/lib/a2a/http";
import { buildAgentCard } from "@/lib/a2a/catalogue";
import { handleStream, handleUnary } from "@/lib/a2a/service";
import { getTask } from "@/lib/a2a/tasks";
import { POST as webhookPost } from "@/app/api/payments/webhook/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ agent: string; rest: string[] }> };

const listParams = (url: URL): ListTasksRequest => {
  const q = url.searchParams;
  const num = (k: string) => (q.get(k) !== null ? Number(q.get(k)) : undefined);
  return {
    contextId: q.get("contextId") ?? undefined,
    status: (q.get("status") as ListTasksRequest["status"]) ?? undefined,
    pageSize: num("pageSize"),
    pageToken: q.get("pageToken") ?? undefined,
    historyLength: num("historyLength"),
    statusTimestampAfter: q.get("statusTimestampAfter") ?? undefined,
    includeArtifacts: q.get("includeArtifacts") === "true",
  };
};

async function handle(req: Request, { params }: Params): Promise<Response> {
  const start = Date.now();
  const { agent, rest } = await params;
  const path = rest.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  let appId: string | null = null;
  let method = `${req.method} ${path}`;
  const fail = (err: A2AError) => {
    recordRequest(start, { appId, agentSlug: agent, method, binding: "rest", ok: false, errorCode: err.code, httpStatus: err.http });
    return restError(err);
  };
  try {
    const entry = entryOr404(agent);

    // ── Public: the card, the personas ──
    if (req.method === "GET" && path === "agent-card.json") {
      return jsonResponse(buildAgentCard(entry, originOf(req).origin), 200, { "cache-control": "public, max-age=300", etag: `"${entry.key}-${entry.version}"` });
    }
    if (req.method === "GET" && path === "sandbox/personas") {
      if (!entry.sandbox) throw new A2AError("UnsupportedOperationError", "this agent is not a sandbox");
      return jsonResponse({ personas: entry.personas });
    }

    const ctx = await contextFor(req, entry);
    appId = ctx.app.id;

    // ── Sandbox: settle a payment without a browser ──
    const settle = /^sandbox\/payments\/([^/]+)\/settle$/.exec(path);
    if (settle && req.method === "POST") {
      if (!entry.sandbox) throw new A2AError("UnsupportedOperationError", "this agent is not a sandbox");
      method = "sandbox.settle";
      const reference = settle[1]!;
      let outcome: "paid" | "failed" = "paid";
      try {
        const body = (await req.json()) as { outcome?: string };
        if (body?.outcome === "failed") outcome = "failed";
      } catch {
        /* no body: paid */
      }
      if (!/^SBX-/.test(reference)) throw new A2AError("InvalidParamsError", "only sandbox payment references (SBX-…) can be settled here", { reference });
      const raw = JSON.stringify({ reference, outcome, gatewayRef: `sandbox-${Date.now().toString(36)}` });
      const secret = process.env.PAYMENT_WEBHOOK_SECRET;
      const headers = new Headers({ "content-type": "application/json" });
      if (secret) headers.set("x-dialog-signature", "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
      const res = await webhookPost(new NextRequest(new URL("/api/payments/webhook", ctx.origin), { method: "POST", headers, body: raw }));
      const result = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 404) throw new A2AError("TaskNotFoundError", "no sandbox payment with that reference", { reference });
      if (!res.ok) throw new A2AError("InternalError", `the payment could not be settled (${res.status})`);
      recordRequest(start, { appId, agentSlug: agent, method, binding: "sandbox", ok: true, httpStatus: 200 });
      return jsonResponse({ ok: true, reference, outcome, idempotent: Boolean(result.idempotent), note: "Any task waiting for this payment continues by itself; poll GetTask or subscribe." });
    }

    // ── HTTP+JSON binding ──
    if (!path.startsWith("rest/")) throw new A2AError("MethodNotFoundError", `no route for ${req.method} /a2a/${agent}/${path}`);
    const op = path.slice("rest/".length);
    const readJson = async () => {
      try {
        return (await req.json()) as unknown;
      } catch {
        throw new A2AError("JSONParseError");
      }
    };
    let m: RegExpExecArray | null;
    if (req.method === "POST" && op === "message:send") {
      method = "SendMessage";
      const result = await handleUnary(ctx, method, await readJson());
      recordRequest(start, { appId, agentSlug: agent, taskId: (result as { task?: { id?: string } }).task?.id ?? null, method, binding: "rest", ok: true, httpStatus: 200 });
      return jsonResponse(result);
    }
    if (req.method === "POST" && op === "message:stream") {
      method = "SendStreamingMessage";
      const events = handleStream(ctx, method, await readJson());
      return sseResponse(events, sseRest, (err) => `data: ${JSON.stringify({ error: err.toJsonRpc() })}\n\n`, (ok, err) =>
        recordRequest(start, { appId, agentSlug: agent, method, binding: "rest", ok, errorCode: err?.code ?? null, httpStatus: 200 })
      );
    }
    if (req.method === "GET" && op === "tasks") {
      method = "ListTasks";
      const result = await handleUnary(ctx, method, listParams(url));
      recordRequest(start, { appId, agentSlug: agent, method, binding: "rest", ok: true, httpStatus: 200 });
      return jsonResponse(result);
    }
    if (req.method === "GET" && (m = /^tasks\/([^/:]+)$/.exec(op))) {
      method = "GetTask";
      const hl = url.searchParams.get("historyLength");
      const result = await getTask(ctx, { id: m[1]!, historyLength: hl !== null ? Number(hl) : undefined });
      recordRequest(start, { appId, agentSlug: agent, taskId: result.id, method, binding: "rest", ok: true, httpStatus: 200 });
      return jsonResponse(result);
    }
    if (req.method === "POST" && (m = /^tasks\/([^/:]+):cancel$/.exec(op))) {
      method = "CancelTask";
      const result = await handleUnary(ctx, method, { id: m[1]! });
      recordRequest(start, { appId, agentSlug: agent, taskId: m[1]!, method, binding: "rest", ok: true, httpStatus: 200 });
      return jsonResponse(result);
    }
    if (req.method === "POST" && (m = /^tasks\/([^/:]+):subscribe$/.exec(op))) {
      method = "SubscribeToTask";
      const events = handleStream(ctx, method, { id: m[1]! });
      return sseResponse(events, sseRest, (err) => `data: ${JSON.stringify({ error: err.toJsonRpc() })}\n\n`, (ok, err) =>
        recordRequest(start, { appId, agentSlug: agent, taskId: m![1]!, method, binding: "rest", ok, errorCode: err?.code ?? null, httpStatus: 200 })
      );
    }
    if (req.method === "GET" && op === "extendedAgentCard") {
      method = "GetExtendedAgentCard";
      await handleUnary(ctx, method, {});
    }
    if (/pushNotificationConfigs/.test(op)) {
      method = "PushNotificationConfig";
      await handleUnary(ctx, "CreateTaskPushNotificationConfig", {});
    }
    throw new A2AError("MethodNotFoundError", `no route for ${req.method} /a2a/${agent}/${path}`);
  } catch (e) {
    return fail(asA2AError(e, `rest:${method}`));
  }
}

export { handle as GET, handle as POST, handle as DELETE };
