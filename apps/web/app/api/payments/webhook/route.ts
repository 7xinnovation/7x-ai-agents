import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { setPayment } from "@dialog/core";
import { getDb, payments } from "@dialog/db";
import { getCase, saveCase, audit } from "@/lib/conversation";
import { emitEvent } from "@/lib/analytics";

export const runtime = "nodejs";

const Body = z.object({
  reference: z.string(),
  outcome: z.enum(["paid", "failed"]).default("paid"),
  gatewayRef: z.string().optional(),
});

/**
 * Payment gateway callback (PRD: payment confirmation via webhook is the
 * authoritative source). Updates the transaction, advances the case payment
 * state, and emits analytics. Idempotent: a paid transaction is not reprocessed.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { reference, outcome, gatewayRef } = parsed.data;

  const db = getDb();
  const [pay] = await db.select().from(payments).where(eq(payments.reference, reference)).limit(1);
  if (!pay) return NextResponse.json({ error: "unknown_reference" }, { status: 404 });
  if (pay.status === "paid") return NextResponse.json({ ok: true, idempotent: true });

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

  return NextResponse.json({ ok: true, reference, status: outcome });
}
