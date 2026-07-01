import { NextRequest } from "next/server";
import { z } from "zod";
import { Locale } from "@dialog/config";
import { resolveAdapters, runTurn, classifyIntent } from "@dialog/core";
import { getDb, payments } from "@dialog/db";
import { getAgentBySlug } from "@/lib/agents";
import { ensureAdapters } from "@/lib/registry";
import { getOrCreateSession, appendMessage, saveCase, audit, saveSessionToken } from "@/lib/conversation";
import { isBusinessOpen } from "@/lib/businessHours";
import { emitEvent } from "@/lib/analytics";
import { buildApiTools } from "@/lib/integrations";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
// Multi-tool turns (e.g. a renewal: details + pricing + payment) can run well past
// 60s; allow up to 5 min so the stream isn't cut mid-turn ("connection lost").
export const maxDuration = 300;

const Body = z.object({
  agentSlug: z.string(),
  userMessage: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  locale: Locale.default("en"),
  authenticated: z.boolean().default(false),
  userRef: z.string().optional(),
  // UAE PASS session token forwarded by the embedding site (for uaepass_live auth).
  uaePassToken: z.string().optional(),
  // Proactive "account pulse": fired by the embed right after sign-in. The server
  // substitutes an internal directive (not a visible user message) that has the
  // agent pull the customer's account data and surface what needs attention.
  pulse: z.boolean().optional(),
});

// Internal directive used for the post-sign-in account pulse. Never shown to the
// user as a message; it instructs the agent to assemble the pulse from real data.
const PULSE_DIRECTIVE =
  "(System: the customer just signed in via UAE PASS. Proactively present their \"Account Pulse\" now — do not wait to be asked. " +
  "1) Greet them warmly (use their name once you have it from account data). " +
  "2) Use your tools to pull everything you can about their account. " +
  "3) Show a concise, scannable section titled \"Account Pulse\" listing anything that needs attention — PO Box renewals that are due or expiring soon (box number, emirate, expiry date, and the renewal fee from pricing) and any pending payments; clearly flag urgent items and offer a quick \"renew now\" next step for each. " +
  "4) If you do not yet know their PO Box number, briefly welcome them and ask once for the box number + emirate so you can complete the pulse. " +
  "Use ONLY real data returned by tools — never invent boxes, dates, or fees.)";

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Streams a conversational turn as SSE. History and case are loaded from the DB
 * (server-authoritative); turns, submissions, payments, and escalations are
 * persisted, audited, and emitted as standardized analytics events.
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
  const businessOpen = isBusinessOpen(agent.definition);
  const isNewSession = !body.conversationId;

  const session = await getOrCreateSession({
    agentId: agent.id,
    conversationId: body.conversationId,
    locale: body.locale,
    authenticated: body.authenticated,
    userRef: body.userRef,
  });

  // Dynamic tools from the agent's API integrations for the ACTIVE environment.
  // Auth precedence: live UAE PASS passthrough > this conversation's stored session
  // token (e.g. from a prior OTP login) > a freshly-minted token captured this turn.
  const apiTools = await buildApiTools(agent.id, agent.definition.activeEnvironment ?? "production", {
    uaePassToken: body.uaePassToken,
    sessionToken: session.sessionToken,
  });
  const { tools: extraTools, exec: runExtraTool } = apiTools;

  // Server-authoritative auth (sticky after UAE PASS), not the client's claim.
  const authenticated = session.authenticated;
  const userRef = session.userRef ?? body.userRef;

  // Account pulse runs only for a signed-in customer; otherwise treat as normal.
  const isPulse = Boolean(body.pulse) && authenticated;
  const effectiveMessage = isPulse ? PULSE_DIRECTIVE : body.userMessage;

  const a = { agentId: agent.id, conversationId: session.conversationId };
  const startJourney = session.state.journeyKey;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (ev: unknown) => { if (!closed) controller.enqueue(encoder.encode(sse(ev))); };
      // Heartbeat: keep the SSE connection alive while the model is thinking or a
      // tool round is running (no bytes flow then), so browsers/proxies don't drop
      // it as idle. SSE comment lines (": ...") are ignored by the client parser.
      const heartbeat = setInterval(() => {
        if (!closed) { try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* closed */ } }
      }, 15000);
      try {
        send({ type: "session", conversationId: session.conversationId });
        if (isNewSession) {
          await emitEvent({ type: "conversation.started", ...a, attributes: { locale: body.locale } });
        }
        // The pulse directive is an internal trigger — don't store it as a user message.
        if (!isPulse) await appendMessage(session.conversationId, "user", body.userMessage);

        // PRD AI-governance: classify intent to gate transactional journeys on goal
        // confidence. Run it CONCURRENTLY with the turn (not blocking) so the first
        // token isn't delayed by an extra model round-trip; the orchestrator awaits
        // it after the first round, by which point it's ready. The gate only matters
        // when STARTING a journey, so skip it once a journey is active or on a pulse.
        let intentPromise: Promise<{ intent: string; confidence: number } | undefined> | undefined;
        if (!session.state.journeyKey && !isPulse) {
          intentPromise = classifyIntent(agent.definition, body.userMessage, body.locale)
            .then((intent) => {
              void emitEvent({
                type: "intent.identified",
                ...a,
                customerType: authenticated ? "authenticated" : "guest",
                language: body.locale,
                outcome: intent.intent,
                attributes: { intent: intent.intent, confidence: intent.confidence },
              }).catch(() => {});
              return intent;
            })
            .catch(() => undefined); // best-effort: a classification failure never blocks
        }

        let finalState = session.state;
        let finalText = "";
        let citedThisTurn = false;

        for await (const ev of runTurn({
          agent: agent.definition,
          agentId: agent.id,
          caseId: session.caseId,
          history: session.history,
          userMessage: effectiveMessage,
          case: session.state,
          locale: body.locale,
          authenticated,
          userRef,
          adapters,
          intentPromise,
          businessOpen,
          extraTools,
          runExtraTool,
        })) {
          send(ev);
          // Standard analytics attributes shared by every event this turn.
          const std = {
            ...a,
            customerType: (authenticated ? "authenticated" : "guest") as "authenticated" | "guest",
            language: body.locale,
            journeyType: finalState.journeyKey ?? undefined,
          };
          if (ev.type === "text") {
            // Accumulate the full streamed reply (including text from rounds
            // before tool calls + the inserted separators) so the persisted
            // message matches what the user saw, not just the final round.
            finalText += ev.delta;
          } else if (ev.type === "case") finalState = ev.state;
          else if (ev.type === "done") {
            finalState = ev.state;
            // Fall back to the round's text only if nothing was streamed.
            if (!finalText) finalText = ev.message;
          } else if (ev.type === "citation" && !citedThisTurn) {
            citedThisTurn = true;
            await emitEvent({ type: "knowledge.retrieved", ...std, attributes: { source: ev.source } });
          } else if (ev.type === "lookup") {
            await emitEvent({ type: "shipment.lookup", ...std, outcome: ev.kind, attributes: { kind: ev.kind } });
          } else if (ev.type === "payment_initiated") {
            await getDb()
              .insert(payments)
              .values({
                caseId: session.caseId,
                conversationId: session.conversationId,
                agentId: agent.id,
                reference: ev.reference,
                amount: Math.round(ev.amount),
                currency: ev.currency,
                status: "initiated",
              })
              .onConflictDoNothing();
            await emitEvent({ type: "payment.initiated", ...std, referenceId: ev.reference, attributes: { reference: ev.reference, amount: ev.amount } });
            await audit({ ...a, actor: "agent", action: "payment_initiated", payload: { reference: ev.reference, amount: ev.amount } });
          } else if (ev.type === "submitted") {
            await audit({ ...a, actor: "agent", action: "case_submitted", payload: { reference: ev.reference, journey: finalState.journeyKey } });
            await emitEvent({ type: "journey.completed", ...std, outcome: "completed", referenceId: ev.reference, attributes: { journey: finalState.journeyKey, reference: ev.reference } });
            await emitEvent({ type: "crm.case.created", ...std, referenceId: ev.reference, attributes: { reference: ev.reference } });
            await emitEvent({ type: "conversation.completed", ...std, outcome: "resolved", referenceId: ev.reference, attributes: { journey: finalState.journeyKey } });
          } else if (ev.type === "escalation") {
            await audit({ ...a, actor: "agent", action: "escalation_created", payload: { reference: ev.reference } });
            await emitEvent({ type: "callback.requested", ...std, referenceId: ev.reference, attributes: { reference: ev.reference, businessOpen } });
          }
        }

        const cust = (authenticated ? "authenticated" : "guest") as "authenticated" | "guest";
        // Journey start detection (journeyKey newly set this turn).
        if (!startJourney && finalState.journeyKey) {
          await emitEvent({ type: "journey.started", ...a, customerType: cust, language: body.locale, journeyType: finalState.journeyKey, attributes: { journey: finalState.journeyKey } });
        }

        await appendMessage(session.conversationId, "assistant", finalText);
        await saveCase(session.caseId, finalState);
        // Persist a session token minted this turn (e.g. OTP login) for later turns.
        const captured = apiTools.getCapturedToken();
        if (captured && captured !== session.sessionToken) {
          await saveSessionToken(session.conversationId, captured);
        }
      } catch (err) {
        log.error("chat_stream_failed", err, { agentId: agent.id, conversationId: session.conversationId });
        send({ type: "error", message: err instanceof Error ? err.message : "stream_failed" });
      } finally {
        clearInterval(heartbeat);
        closed = true;
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
