import { getDb, analyticsEvents } from "@dialog/db";
import { log } from "./logger";

/**
 * Standardized analytics event taxonomy (PRD). Emitted across journeys to power
 * the KPI dashboard, conversation/journey analytics, escalation and SLA views.
 */
export type AnalyticsType =
  | "conversation.started"
  | "conversation.completed"
  | "intent.identified"
  | "journey.started"
  | "journey.completed"
  | "journey.abandoned"
  | "shipment.lookup"
  | "payment.initiated"
  | "payment.completed"
  | "payment.failed"
  | "callback.requested"
  | "crm.case.created"
  | "knowledge.retrieved"
  | "sla_breach_detected";

/**
 * Emit one analytics event with the PRD's standardized minimum attribute set
 * (event_timestamp, conversation_id, journey_type, customer_type, language,
 * channel, event_outcome, reference_id) merged in alongside any event-specific
 * attributes. Best-effort: never throws into a customer journey.
 */
export async function emitEvent(input: {
  type: AnalyticsType;
  agentId?: string;
  conversationId?: string;
  journeyType?: string;
  customerType?: "guest" | "authenticated";
  language?: string;
  channel?: string;
  outcome?: string;
  referenceId?: string;
  attributes?: Record<string, unknown>;
}) {
  const standard = {
    event_timestamp: new Date().toISOString(),
    conversation_id: input.conversationId ?? null,
    journey_type: input.journeyType ?? null,
    customer_type: input.customerType ?? null,
    language: input.language ?? null,
    channel: input.channel ?? "web",
    event_outcome: input.outcome ?? null,
    reference_id: input.referenceId ?? null,
  };
  try {
    await getDb().insert(analyticsEvents).values({
      agentId: input.agentId,
      conversationId: input.conversationId,
      type: input.type,
      attributes: { ...standard, ...(input.attributes ?? {}) },
    });
  } catch (err) {
    // Analytics must never break a customer journey — log, don't throw.
    log.warn("analytics_emit_failed", { type: input.type, conversationId: input.conversationId, error: err instanceof Error ? err.message : String(err) });
  }
}
