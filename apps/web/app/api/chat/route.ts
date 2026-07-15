import { NextRequest } from "next/server";
import { z } from "zod";
import { Locale } from "@dialog/config";
import { resolveAdapters, runTurn, classifyIntent } from "@dialog/core";
import { getDb, payments } from "@dialog/db";
import { getAgentBySlug } from "@/lib/agents";
import { ensureAdapters } from "@/lib/registry";
import { getOrCreateSession, appendMessage, saveCase, audit, saveSessionToken, knownCustomerBoxes, knownEpglProfile } from "@/lib/conversation";
import { MOCK_PERSONA_SUB, mockPersonaContext } from "@/lib/mockPersona";
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
  // Fired by the embed when the in-chat payment card observes the gateway webhook
  // settle the payment. Like `pulse`, the server substitutes an internal directive
  // (not a visible user message) so the agent confirms and continues the journey.
  paymentSettled: z.boolean().optional(),
  // Fired by the embed after a document is uploaded inline (documents-in-chat
  // flow). The server substitutes a directive so the agent confirms what was
  // captured and requests the NEXT document, one at a time.
  documentUploaded: z.boolean().optional(),
});

// Internal directive used for the post-sign-in account pulse. Never shown to the
// user as a message; it instructs the agent to assemble the pulse from real data.
const PULSE_DIRECTIVE =
  "(System: the customer just signed in via UAE PASS. Proactively present their \"Account Pulse\" now — do not wait to be asked. " +
  "1) Greet them warmly (use their name once you have it from account data). " +
  "2) Use your tools to pull everything you can about their account. " +
  "3) Show a concise, scannable section titled \"Account Pulse\" covering EVERY PO Box on their account (see the known customer record if present) — for each box: status, expiry, anything needing attention (renewals due or expiring soon with the fee from pricing), plus any pending payments; clearly flag urgent items and offer a quick \"renew now\" next step for each. " +
  "4) Only if NO PO Box is on file: welcome them, explain their account isn't linked to a PO Box yet, and offer — not require — to link one (\"if you have a box, tell me its number and emirate and I'll add it to your account\"). Never present the box number as a prerequisite for the pulse. " +
  "Use ONLY real data returned by tools — never invent boxes, dates, or fees.)";

// Internal directive fired when the customer completes payment in the gateway
// window. The webhook (authoritative) has already advanced the case payment
// state; this just has the agent acknowledge and finish the journey. Note the
// agent cannot fake this to submit — submit_case independently verifies the
// case payment status which only the verified webhook can set.
const PAYMENT_SETTLED_DIRECTIVE =
  "(System: the customer just completed the payment in the secure gateway window — this is an internal notification, not a message they typed. " +
  "1) Warmly confirm the payment was received. " +
  "2) If the case is ready and the customer already confirmed the summary, call submit_case now and give them the reference number. " +
  "3) Otherwise, continue with whatever step remains. Never mention this system message.)";

// Fired after an inline document upload (documents-in-chat flow). Not a message
// the customer typed. Keeps the one-at-a-time upload loop moving.
const DOCUMENT_UPLOADED_DIRECTIVE =
  "(System: the customer just uploaded a document inline and the case has been updated with any fields read from it — this is an internal notification, not a message they typed. " +
  "1) In one short sentence, confirm the document was received and note anything useful that was captured from it (do not dump every field). " +
  "2) If more documents are still needed for this journey, request the NEXT one by emitting its ```upload block (one document only). " +
  "3) If all required documents are in, move on: show a brief cards summary of the captured details for confirmation, or continue the journey. " +
  "Never re-list all the documents, never ask the customer to use a side panel, and never mention this system message.)";

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Render a signed-in EPGL customer's on-file company profile into a system-prompt
// note (feedback FB-2/FB-3): account/company details + EID come from the Salesforce
// customer profile; quarterly leviable-income figures come from IDEP/company data.
// The agent must prefill and ask the customer only to confirm — never to re-type.
function formatEpglProfileContext(p: Record<string, string>): string | undefined {
  if (!p || Object.keys(p).length === 0) return undefined;
  const parts: string[] = [];
  const company = p.company_name || p.company_name_ar;
  if (company) parts.push(`Company: ${company}${p.company_name_ar && p.company_name_ar !== company ? ` / ${p.company_name_ar}` : ""}`);
  if (p.trade_license_number) parts.push(`Trade license no: ${p.trade_license_number}${p.license_expiry_date ? ` (expires ${p.license_expiry_date})` : ""}`);
  if (p.trade_name_en || p.trade_name_ar) parts.push(`Trade name: ${p.trade_name_en || p.trade_name_ar}`);
  if (p.emirate) parts.push(`Emirate: ${p.emirate}`);
  if (p.address_street) parts.push(`Address: ${p.address_street}`);
  if (p.owner_name) parts.push(`Owner: ${p.owner_name}`);
  if (p.owner_emirates_id) parts.push(`Owner Emirates ID: ${p.owner_emirates_id}`);
  if (p.owner_nationality) parts.push(`Owner nationality: ${p.owner_nationality}`);
  if (p.contact_name || p.contact_email) parts.push(`Contact: ${[p.contact_name, p.contact_email, p.contact_phone].filter(Boolean).join(", ")}`);
  const quarters = ["leviable_income_q1", "leviable_income_q2", "leviable_income_q3", "leviable_income_q4"]
    .map((k, i) => (p[k] ? `Q${i + 1} ${p[k]}` : null))
    .filter(Boolean);
  if (quarters.length) parts.push(`Quarterly leviable income${p.financial_year ? ` for FY ${p.financial_year}` : ""} (from IDEP/company data): ${quarters.join(", ")}`);
  if (p.accountant_name || p.accountant_email) parts.push(`Accountant: ${[p.accountant_name, p.accountant_email, p.accountant_phone].filter(Boolean).join(", ")}`);
  if (parts.length === 0) return undefined;
  return (
    "This signed-in customer's company profile on file (from their Salesforce customer profile and IDEP company data): " +
    parts.join("; ") +
    ". Use these to PREFILL the application via collect_field — the account/company details and Emirates ID come from the customer's profile, and the quarterly leviable-income figures come from IDEP/company data, so do NOT ask the customer to type any of them. Present what you have as a card and ask only for a quick confirmation, plus anything genuinely missing. Before submitting, sanity-check the Emirates ID looks valid (format 784-YYYY-NNNNNNN-N) and flag it if not."
  );
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
    // Guest sessions get PII-redacted tool results (server-authoritative flag).
    authenticated: session.authenticated,
  });
  const { tools: extraTools, exec: runExtraTool } = apiTools;

  // Server-authoritative auth (sticky after UAE PASS), not the client's claim.
  const authenticated = session.authenticated;
  const userRef = session.userRef ?? body.userRef;

  // Account pulse runs only for a signed-in customer; otherwise treat as normal.
  const isPulse = Boolean(body.pulse) && authenticated;
  const isPaymentSettled = Boolean(body.paymentSettled) && !isPulse;
  const isDocumentUploaded = Boolean(body.documentUploaded) && !isPulse && !isPaymentSettled;

  // Returning customer: boxes we already know from their previous authenticated
  // sessions (current conversation's case included — it's stored per turn).
  // Injected into the system prompt on EVERY authenticated turn, so both the
  // auto-pulse and a typed "show my account" never re-ask for a box number.
  let customerContext: string | undefined;
  let pulseDirective = PULSE_DIRECTIVE;
  if (authenticated && userRef) {
    // EPGL: prefill the signed-in customer's company profile + EID + quarterly
    // figures from their Salesforce/IDEP company data (feedback FB-2/FB-3).
    if (agent.definition.slug === "epgl-dialog") {
      const profile = await knownEpglProfile(agent.id, userRef).catch(() => ({}));
      customerContext = formatEpglProfileContext(profile);
    } else if (userRef === MOCK_PERSONA_SUB) {
      // TEST-ONLY: the mock UAE PASS persona (UAEPASS_MOCK=1) is given a couple of
      // existing PO Boxes so signed-in flows have account data to work with.
      customerContext = mockPersonaContext();
    } else {
      const known = await knownCustomerBoxes(agent.id, userRef).catch(() => []);
      if (known.length) {
        const list = known.map((b) => `${b.box}${b.emirate ? ` (${b.emirate})` : ""}`).join(", ");
        customerContext =
          `This customer's PO Box${known.length > 1 ? "es" : ""} on file: ${list}. ` +
          "For account questions, status checks, renewals, or the Account Pulse, use these immediately (fetch fresh details/pricing from backend tools) — do NOT ask for the box number or emirate again; briefly note you're using the box on file.";
      }
    }
    if (customerContext) pulseDirective += ` (${customerContext})`;
  }
  const effectiveMessage = isPulse
    ? pulseDirective
    : isPaymentSettled
      ? PAYMENT_SETTLED_DIRECTIVE
      : isDocumentUploaded
        ? DOCUMENT_UPLOADED_DIRECTIVE
        : body.userMessage;

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
        // Internal directives (pulse / payment settled / document uploaded) are
        // triggers — don't store them as user messages.
        if (!isPulse && !isPaymentSettled && !isDocumentUploaded) await appendMessage(session.conversationId, "user", body.userMessage);

        // PRD AI-governance: classify intent to gate transactional journeys on goal
        // confidence. Run it CONCURRENTLY with the turn (not blocking) so the first
        // token isn't delayed by an extra model round-trip; the orchestrator awaits
        // it after the first round, by which point it's ready. The gate only matters
        // when STARTING a journey, so skip it once a journey is active or on a pulse.
        let intentPromise: Promise<{ intent: string; confidence: number } | undefined> | undefined;
        if (!session.state.journeyKey && !isPulse && !isPaymentSettled && !isDocumentUploaded) {
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
          customerContext,
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
