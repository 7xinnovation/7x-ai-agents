import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, payments } from "@dialog/db";

export const runtime = "nodejs";

/**
 * Lightweight status probe for the in-chat payment card: the embed polls this
 * while the customer completes payment in the gateway popup, so the chat can
 * flip to "paid" the moment the webhook lands. Scoped by conversationId so a
 * caller can only read payments belonging to their own session.
 */
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference");
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!reference || !conversationId) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const [pay] = await getDb()
    .select({ status: payments.status })
    .from(payments)
    .where(and(eq(payments.reference, reference), eq(payments.conversationId, conversationId)))
    .limit(1);
  if (!pay) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ status: pay.status }, { headers: { "Cache-Control": "no-store" } });
}
