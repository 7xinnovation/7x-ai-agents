import { getDb, analyticsEvents } from "@dialog/db";

/**
 * Standardized analytics event taxonomy (PRD). Emitted across journeys to power
 * the KPI dashboard, conversation/journey analytics, escalation and SLA views.
 */
export type AnalyticsType =
  | "conversation.started"
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
  | "knowledge.retrieved";

export async function emitEvent(input: {
  type: AnalyticsType;
  agentId?: string;
  conversationId?: string;
  attributes?: Record<string, unknown>;
}) {
  try {
    await getDb().insert(analyticsEvents).values({
      agentId: input.agentId,
      conversationId: input.conversationId,
      type: input.type,
      attributes: input.attributes ?? {},
    });
  } catch {
    // Analytics must never break a customer journey.
  }
}
