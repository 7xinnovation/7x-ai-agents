import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
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
