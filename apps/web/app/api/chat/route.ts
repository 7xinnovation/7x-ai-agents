import { NextRequest } from "next/server";
import { z } from "zod";
import { Locale } from "@dialog/config";
import { resolveAdapters, runTurn } from "@dialog/core";
import { getAgentBySlug } from "@/lib/agents";
import { ensureAdapters } from "@/lib/registry";
import { getOrCreateSession, appendMessage, saveCase, audit } from "@/lib/conversation";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  agentSlug: z.string(),
  userMessage: z.string().min(1),
  // Resume an existing session; omit to start a new one.
  conversationId: z.string().uuid().optional(),
  locale: Locale.default("en"),
  authenticated: z.boolean().default(false),
  userRef: z.string().optional(),
});

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Streams a conversational turn as SSE. History and case are loaded from the DB
 * (server-authoritative), and every turn — plus submissions/escalations — is
 * persisted and audited.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400 });
  }
  const body = parsed.data;

  const agent = await getAgentBySlug(body.agentSlug);
  if (!agent) return new Response(JSON.stringify({ error: "agent_not_found" }), { status: 404 });

  ensureAdapters();
  const adapters = resolveAdapters(agent.definition);

  const session = await getOrCreateSession({
    agentId: agent.id,
    conversationId: body.conversationId,
    locale: body.locale,
    authenticated: body.authenticated,
    userRef: body.userRef,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: unknown) => controller.enqueue(encoder.encode(sse(ev)));
      try {
        // Tell the client which session it's on (for resume + subsequent turns).
        send({ type: "session", conversationId: session.conversationId });
        await appendMessage(session.conversationId, "user", body.userMessage);

        let finalState = session.state;
        let finalText = "";

        for await (const ev of runTurn({
          agent: agent.definition,
          agentId: agent.id,
          history: session.history,
          userMessage: body.userMessage,
          case: session.state,
          locale: body.locale,
          authenticated: body.authenticated,
          userRef: body.userRef,
          adapters,
        })) {
          send(ev);
          if (ev.type === "case") finalState = ev.state;
          else if (ev.type === "done") {
            finalState = ev.state;
            finalText = ev.message;
          } else if (ev.type === "submitted") {
            await audit({
              agentId: agent.id,
              conversationId: session.conversationId,
              actor: "agent",
              action: "case_submitted",
              payload: { reference: ev.reference, journey: finalState.journeyKey },
            });
          } else if (ev.type === "escalation") {
            await audit({
              agentId: agent.id,
              conversationId: session.conversationId,
              actor: "agent",
              action: "escalation_created",
              payload: { reference: ev.reference },
            });
          }
        }

        await appendMessage(session.conversationId, "assistant", finalText);
        await saveCase(session.caseId, finalState);
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "stream_failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
