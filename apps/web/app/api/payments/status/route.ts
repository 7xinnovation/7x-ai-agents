import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, payments } from "@dialog/db";
import { resolveAdapters, adapterContext, setPayment } from "@dialog/core";
import { getAgentById } from "@/lib/agents";
import { ensureAdapters } from "@/lib/registry";
import { getCase, saveCase, audit } from "@/lib/conversation";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Lightweight status probe for the in-chat payment card: the embed polls this
 * while the customer completes payment in the gateway popup, so the chat can
 * flip to "paid" as soon as the payment settles. Scoped by conversationId so a
 * caller can only read payments belonging to their own session.
 *
 * The stored row is authoritative once it has moved off "initiated" — the mock
 * gateway's signed webhook sets it. A REAL gateway (N-Genius) does not call that
 * webhook, so while the row is still "initiated" we ask the gateway itself,
 * exactly as the reconcile sweep does. Without this the card would spin until
 * the next sweep and the journey could never complete in the conversation.
 */
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference");
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!reference || !conversationId) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const db = getDb();
  const [pay] = await db
    .select({ status: payments.status, agentId: payments.agentId })
    .from(payments)
    .where(and(eq(payments.reference, reference), eq(payments.conversationId, conversationId)))
    .limit(1);
  if (!pay) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (pay.status !== "initiated" || !pay.agentId) {
    return NextResponse.json({ status: pay.status }, { headers: { "Cache-Control": "no-store" } });
  }

  // Still open — ask the gateway. Best-effort: a probe failure just means the
  // customer keeps waiting, and the reconcile sweep remains the backstop.
  let status: "initiated" | "paid" | "failed" = pay.status;
  try {
    const agent = await getAgentById(pay.agentId);
    if (agent) {
      ensureAdapters();
      const adapters = resolveAdapters(agent.definition);
      if (adapters.payment) {
        const actx = adapterContext(agent.definition, agent.definition.integrations.payment);
        ({ status } = await adapters.payment.getStatus(actx, { reference }));
      }
    }
  } catch (err) {
    log.error("payment_status_probe_failed", err, { reference, conversationId });
  }

  if (status !== "initiated") {
    await db.update(payments).set({ status, updatedAt: new Date() }).where(eq(payments.reference, reference));
    const c = await getCase(conversationId);
    if (c) await saveCase(c.caseId, setPayment(c.state, { status }));
    await audit({
      agentId: pay.agentId,
      conversationId,
      actor: "system",
      action: `payment_${status}_via_gateway_probe`,
      payload: { reference },
    });
  }

  return NextResponse.json({ status }, { headers: { "Cache-Control": "no-store" } });
}
