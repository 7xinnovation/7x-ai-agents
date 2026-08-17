import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { setPayment } from "@dialog/core";
import { getDb, payments } from "@dialog/db";
import { getCase, saveCase, audit } from "@/lib/conversation";
import { emitEvent } from "@/lib/analytics";
import { getAgentById } from "@/lib/agents";
import { notifyEpglPayment } from "@/lib/epglPayment";

export const runtime = "nodejs";

const Body = z.object({
  reference: z.string(),
  outcome: z.enum(["paid", "failed"]).default("paid"),
  gatewayRef: z.string().optional(),
});

/** Verify the gateway HMAC-SHA256 signature over the raw body (PRD: never trust
 * an unauthenticated callback to flip a payment to paid). When
 * PAYMENT_WEBHOOK_SECRET is unset (dev/mock) signing is skipped. */
function verifySignature(raw: string, header: string | null): boolean {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return true; // dev/mock mode — no signing configured
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const provided = header.replace(/^sha256=/, "");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Payment gateway callback (PRD: payment confirmation via webhook is the
 * authoritative source). Verifies the signature, updates the transaction,
 * advances the case payment state, and emits analytics. Idempotent: a paid
 * transaction is not reprocessed.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-dialog-signature"))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  let json: unknown;
  try { json = JSON.parse(raw || "{}"); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { reference, outcome, gatewayRef } = parsed.data;

  const db = getDb();
  const [pay] = await db.select().from(payments).where(eq(payments.reference, reference)).limit(1);
  if (!pay) return NextResponse.json({ error: "unknown_reference" }, { status: 404 });
  if (pay.status === "paid") {
    // Already settled — but make sure the conversation's case state reflects it
    // (a retried webhook must still leave the case submittable, even if an
    // earlier delivery failed to advance it).
    if (pay.conversationId) {
      const c = await getCase(pay.conversationId);
      if (c && c.state.payment.status !== "paid") await saveCase(c.caseId, setPayment(c.state, { status: "paid" }));
    }
    return NextResponse.json({ ok: true, idempotent: true });
  }

  await db
    .update(payments)
    .set({ status: outcome, gatewayRef: gatewayRef ?? null, updatedAt: new Date() })
    .where(eq(payments.reference, reference));

  // Advance the case payment state so the next turn can submit.
  if (pay.conversationId) {
    const c = await getCase(pay.conversationId);
    if (c) await saveCase(c.caseId, setPayment(c.state, { status: outcome }));
  }

  await audit({
    agentId: pay.agentId ?? undefined,
    conversationId: pay.conversationId ?? undefined,
    actor: "system",
    action: outcome === "paid" ? "payment_confirmed" : "payment_failed",
    payload: { reference },
  });
  await emitEvent({
    type: outcome === "paid" ? "payment.completed" : "payment.failed",
    agentId: pay.agentId ?? undefined,
    conversationId: pay.conversationId ?? undefined,
    attributes: { reference, amount: pay.amount },
  });

  // Tell EPGL's Salesforce the fee was paid. Salesforce creates the Payment
  // Advice, Invoice and Receipt itself, but it cannot know the money arrived —
  // the customer paid through our gateway. Without this the Advice stays unpaid
  // and the licence request never reaches "Payment Verified".
  //
  // Here rather than in a model tool on purpose: settlement is only trustworthy
  // from the signed webhook, and marking a fee paid is not something the agent
  // should be able to do because a conversation went well.
  if (outcome === "paid" && pay.agentId && pay.conversationId) {
    await notifyEpglIfLicenceFee(pay.agentId, pay.conversationId, reference, Number(pay.amount ?? 0));
  }

  return NextResponse.json({ ok: true, reference, status: outcome });
}

/**
 * Best-effort notification to EPGL Salesforce. Deliberately swallows every
 * failure: the money has already moved by the time this runs, so a Salesforce
 * problem must not fail the webhook and have the gateway retry a payment that is
 * settled on our side. Every outcome is audited, so an unnotified payment is
 * visible rather than silent.
 */
async function notifyEpglIfLicenceFee(
  agentId: string,
  conversationId: string,
  reference: string,
  amount: number
): Promise<void> {
  try {
    const agent = await getAgentById(agentId);
    if (!agent || agent.definition.tenantSlug !== "epgl") return;

    const c = await getCase(conversationId);
    // The licence request's Salesforce id is the case reference once submitted.
    // Before submission there is nothing to notify against, which is normal:
    // EPGL takes payment after the review, so the request always exists first.
    const licenseRequestId = String(c?.state.reference ?? "").trim();
    if (!licenseRequestId) return;

    const env = agent.definition.activeEnvironment ?? "production";
    const res = await notifyEpglPayment(agent.id, env, {
      licenseRequestId,
      paymentId: reference,
      amount,
      currency: "AED",
    });

    await audit({
      agentId,
      conversationId,
      actor: "system",
      action: res.ok ? "epgl_payment_notified" : "epgl_payment_notify_failed",
      payload: res.ok
        ? { reference, licenseRequestId, correlationId: res.correlationId }
        : { reference, licenseRequestId, status: res.status, reason: res.reason, retryable: res.retryable },
    });
  } catch (e) {
    await audit({
      agentId,
      conversationId,
      actor: "system",
      action: "epgl_payment_notify_failed",
      payload: { reference, reason: e instanceof Error ? e.message : "unknown error", retryable: true },
    });
  }
}
