/**
 * The rows behind the two numbers on the dashboard (2 November 2026).
 *
 * Emirates Post: "need a route to transaction details if I clicked on journeys
 * completed to understand the journey details. And payment received (all
 * details about the transactions). Currently it says 39 journeys completed with
 * no information about any of them."
 *
 * Which is exactly right. `journey.completed` has been counted since the
 * beginning and never listed, so the one question a completion count provokes —
 * WHICH thirty-nine? — had no answer anywhere in the product. The events carry
 * the conversation, the journey and the reference already; nothing new has to be
 * recorded, it only has to be read.
 *
 * A completion and a payment are joined on the conversation rather than on a
 * reference, because the two sides spell references differently (EPGL's LR-xxxxx
 * is the application, ours is the payment's own) and not every completed journey
 * takes money at all.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, agents, analyticsEvents, payments } from "@dialog/db";

export type Window = number | "all";

/** The cut-off for a window, or null for all time. */
export function windowStart(windowDays: Window): Date | null {
  if (windowDays === "all") return null;
  const d = new Date();
  d.setDate(d.getDate() - windowDays);
  return d;
}

export interface CompletedJourney {
  conversationId: string | null;
  agentName: string | null;
  agentSlug: string | null;
  journey: string | null;
  reference: string | null;
  customerType: string | null;
  language: string | null;
  channel: string | null;
  completedAt: Date;
  /** The payment taken in the same conversation, when there was one. */
  payment: { reference: string; amount: number; currency: string; status: string; provider: string | null } | null;
}

export interface PaymentRow {
  id: string;
  conversationId: string | null;
  agentName: string | null;
  agentSlug: string | null;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  provider: string | null;
  gatewayRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Which of two payments on one conversation describes how it ended.
 *
 * Settled beats open beats declined. A customer whose card is refused and who
 * then pays leaves two rows, and on a busy second they can carry the same
 * timestamp — so ordering by time alone picks one at random and a completed
 * journey reads "declined" beside a licence that was issued.
 */
export function paymentRank(status: string): number {
  return status === "paid" ? 2 : status === "initiated" ? 1 : 0;
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * Completed journeys, newest first.
 *
 * The payment is fetched for the page's conversations in one go rather than
 * joined in SQL: a conversation can hold more than one payment (a retry after a
 * decline is a second row), and a join would then show the same completion
 * twice. The newest payment is the one that settled it.
 */
export async function completedJourneys(opts: {
  windowDays?: Window;
  agentId?: string | null;
  limit?: number;
}): Promise<CompletedJourney[]> {
  const db = getDb();
  const since = windowStart(opts.windowDays ?? "all");
  const where = [eq(analyticsEvents.type, "journey.completed")];
  if (opts.agentId) where.push(eq(analyticsEvents.agentId, opts.agentId));
  if (since) where.push(gte(analyticsEvents.createdAt, since));

  const rows = await db
    .select({
      conversationId: analyticsEvents.conversationId,
      attributes: analyticsEvents.attributes,
      createdAt: analyticsEvents.createdAt,
      agentName: agents.name,
      agentSlug: agents.slug,
    })
    .from(analyticsEvents)
    .leftJoin(agents, eq(analyticsEvents.agentId, agents.id))
    .where(and(...where))
    .orderBy(desc(analyticsEvents.createdAt))
    .limit(opts.limit ?? 200);

  const ids = [...new Set(rows.map((r) => r.conversationId).filter((x): x is string => Boolean(x)))];
  const best = new Map<string, NonNullable<CompletedJourney["payment"]>>();
  if (ids.length) {
    const prows = await db
      .select({
        conversationId: payments.conversationId,
        reference: payments.reference,
        amount: payments.amount,
        currency: payments.currency,
        status: payments.status,
        provider: payments.provider,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(inArray(payments.conversationId, ids))
      .orderBy(desc(payments.createdAt));
    /**
     * A SETTLEMENT BEATS A DECLINE, WHATEVER THE CLOCK SAYS.
     *
     * A customer whose card is refused and who then pays has two rows, and on a
     * busy second they can carry the same timestamp — so "newest" alone picks
     * one at random and the completed journey reads "declined" next to a
     * licence that was issued. Settled wins; among equals, the newest.
     */
    for (const p of prows) {
      if (!p.conversationId) continue;
      const held = best.get(p.conversationId);
      if (held && paymentRank(held.status) >= paymentRank(p.status)) continue;
      best.set(p.conversationId, {
        reference: p.reference,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        provider: p.provider ?? null,
      });
    }
  }

  return rows.map((r) => {
    const a = (r.attributes ?? {}) as Record<string, unknown>;
    return {
      conversationId: r.conversationId,
      agentName: r.agentName ?? null,
      agentSlug: r.agentSlug ?? null,
      journey: str(a.journey) ?? str(a.journey_type),
      reference: str(a.reference) ?? str(a.reference_id),
      customerType: str(a.customer_type),
      language: str(a.language) ?? str(a.locale),
      channel: str(a.channel),
      completedAt: r.createdAt,
      payment: (r.conversationId && best.get(r.conversationId)) || null,
    };
  });
}

/** Every payment raised, newest first — settled, declined and still open. */
export async function paymentRows(opts: {
  windowDays?: Window;
  agentId?: string | null;
  status?: string | null;
  limit?: number;
}): Promise<PaymentRow[]> {
  const db = getDb();
  const since = windowStart(opts.windowDays ?? "all");
  const where = [];
  if (opts.agentId) where.push(eq(payments.agentId, opts.agentId));
  if (since) where.push(gte(payments.createdAt, since));
  if (opts.status && ["initiated", "paid", "failed"].includes(opts.status)) {
    where.push(eq(payments.status, opts.status as "initiated" | "paid" | "failed"));
  }

  const rows = await db
    .select({
      id: payments.id,
      conversationId: payments.conversationId,
      reference: payments.reference,
      amount: payments.amount,
      currency: payments.currency,
      status: payments.status,
      provider: payments.provider,
      gatewayRef: payments.gatewayRef,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
      agentName: agents.name,
      agentSlug: agents.slug,
    })
    .from(payments)
    .leftJoin(agents, eq(payments.agentId, agents.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(opts.limit ?? 200);

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    agentName: r.agentName ?? null,
    agentSlug: r.agentSlug ?? null,
    reference: r.reference,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    provider: r.provider ?? null,
    gatewayRef: r.gatewayRef ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/** What the payments page totals at the top. */
export function paymentTotals(rows: PaymentRow[]) {
  const settled = rows.filter((r) => r.status === "paid");
  return {
    count: rows.length,
    settled: settled.length,
    declined: rows.filter((r) => r.status === "failed").length,
    open: rows.filter((r) => r.status === "initiated").length,
    /** Only money that actually arrived. An initiated payment is not revenue. */
    settledAmount: settled.reduce((n, r) => n + r.amount, 0),
  };
}
