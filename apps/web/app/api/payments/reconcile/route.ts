import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { resolveAdapters, setPayment, adapterContext } from "@dialog/core";
import { getDb, payments, agents, conversations, cases, escalations, analyticsEvents, auditLog } from "@dialog/db";
import { getAgentById } from "@/lib/agents";
import { ensureAdapters } from "@/lib/registry";
import { getCase, saveCase, audit } from "@/lib/conversation";
import { notifyEpglIfLicenceFee } from "@/lib/epglPayment";
import { emitEvent } from "@/lib/analytics";

export const runtime = "nodejs";

// Thresholds (minutes). Configurable via env for ops tuning.
const PAYMENT_STALE_MIN = Number(process.env.RECONCILE_PAYMENT_MIN ?? 15);
const ABANDON_MIN = Number(process.env.RECONCILE_ABANDON_MIN ?? 30);
const CALLBACK_SLA_MIN = Number(process.env.RECONCILE_CALLBACK_SLA_MIN ?? 240); // 4h

/**
 * Reconciliation + SLA sweep (PRD: transaction recovery & reconciliation; SLA
 * monitoring; journey abandonment). Intended to run on a schedule (cron). Protected
 * by CRON_SECRET when set. Idempotent — re-emitting is guarded by existing events.
 */
export async function POST(req: NextRequest) {
  if (process.env.CRON_SECRET && req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  ensureAdapters();
  const db = getDb();
  const now = Date.now();
  const out = { paymentsChecked: 0, paymentsResolved: 0, paymentsBreached: 0, abandoned: 0, callbackBreaches: 0 };

  // 1) Orphaned payments: still "initiated" past the stale window → ask the
  // gateway for the authoritative status and reconcile; flag a breach if stuck.
  const staleCut = new Date(now - PAYMENT_STALE_MIN * 60_000);
  const stale = await db.select().from(payments).where(and(eq(payments.status, "initiated"), lt(payments.createdAt, staleCut)));
  for (const p of stale) {
    out.paymentsChecked++;
    if (!p.agentId) continue;
    const agent = await getAgentById(p.agentId);
    if (!agent) continue;
    const adapters = resolveAdapters(agent.definition);
    if (!adapters.payment) continue;
    let status: "initiated" | "paid" | "failed" = "initiated";
    try {
      const actx = adapterContext(agent.definition, agent.definition.integrations.payment);
      ({ status } = await adapters.payment.getStatus(actx, { reference: p.reference }));
    } catch { /* leave as-is, will retry next sweep */ }
    if (status !== "initiated") {
      await db.update(payments).set({ status, updatedAt: new Date() }).where(eq(payments.id, p.id));
      if (p.conversationId) {
        const c = await getCase(p.conversationId);
        if (c) await saveCase(c.caseId, setPayment(c.state, { status }));
      }
      await audit({ agentId: p.agentId, conversationId: p.conversationId ?? undefined, actor: "system", action: `payment_reconciled_${status}`, payload: { reference: p.reference } });
      await emitEvent({ type: status === "paid" ? "payment.completed" : "payment.failed", agentId: p.agentId, conversationId: p.conversationId ?? undefined, referenceId: p.reference, outcome: `reconciled_${status}`, attributes: { reference: p.reference, reconciled: true } });
      // The backstop has to include telling Salesforce. This sweep exists for
      // the payments nothing else caught, and a licence fee we found here is
      // exactly one nobody has notified -- the notifier is idempotent, so a
      // webhook or probe that got there first costs nothing.
      if (status === "paid" && p.conversationId) {
        await notifyEpglIfLicenceFee(p.agentId, p.conversationId, p.reference, Number(p.amount ?? 0));
      }
      out.paymentsResolved++;
    } else {
      // Still unresolved past threshold → SLA breach (once per reference).
      const seen = await db.select({ id: analyticsEvents.id }).from(analyticsEvents).where(and(eq(analyticsEvents.type, "sla_breach_detected"), sql`${analyticsEvents.attributes} ->> 'reference' = ${p.reference}`)).limit(1);
      if (!seen.length) {
        await emitEvent({ type: "sla_breach_detected", agentId: p.agentId, conversationId: p.conversationId ?? undefined, referenceId: p.reference, outcome: "payment_stuck", attributes: { reference: p.reference, kind: "payment", ageMinutes: Math.round((now - new Date(p.createdAt).getTime()) / 60000) } });
        out.paymentsBreached++;
      }
    }
  }

  /**
   * 1b) EPGL licence fees that have been paid and still not reported.
   *
   * A new licence carries no payment advice when it is created, so the
   * notification is deferred rather than sent against nothing — see
   * paymentAdviceExists. Deferring is only safe if something asks again, and
   * the sweep above cannot: it looks at payments still "initiated", and these
   * are paid. So they are picked up here, by the absence of the audit row that
   * makes the notifier idempotent.
   *
   * Bounded to a week. A fee still unreported after that is not going to be
   * fixed by another attempt, and it should be found by someone reading the
   * deferral audits rather than retried forever.
   */
  const unreportedCut = new Date(now - 7 * 24 * 60 * 60_000);
  const paidUnreported = await db
    .select({ agentId: payments.agentId, conversationId: payments.conversationId, reference: payments.reference, amount: payments.amount })
    .from(payments)
    .where(
      and(
        eq(payments.status, "paid"),
        gt(payments.createdAt, unreportedCut),
        sql`not exists (select 1 from ${auditLog} a where a.conversation_id = ${payments.conversationId}
              and a.action = 'epgl_payment_notified' and a.payload ->> 'reference' = ${payments.reference})`
      )
    );
  for (const p of paidUnreported) {
    if (!p.agentId || !p.conversationId) continue;
    // Not EPGL, or no licence request yet: the notifier decides and returns.
    await notifyEpglIfLicenceFee(p.agentId, p.conversationId, p.reference, Number(p.amount ?? 0));
  }

  // 2) Abandoned journeys: a draft case with a journey set, idle past the window,
  // never completed → emit journey.abandoned once.
  const abandonCut = new Date(now - ABANDON_MIN * 60_000);
  const draftCases = await db
    .select({ conversationId: cases.conversationId, agentId: cases.agentId, state: cases.state, updatedAt: cases.updatedAt })
    .from(cases)
    .where(lt(cases.updatedAt, abandonCut));
  for (const c of draftCases) {
    const st = c.state as { journeyKey?: string | null; status?: string };
    if (!st?.journeyKey || st.status === "submitted" || st.status === "escalated") continue;
    const seen = await db.select({ id: analyticsEvents.id }).from(analyticsEvents).where(and(eq(analyticsEvents.conversationId, c.conversationId), sql`${analyticsEvents.type} in ('journey.abandoned','journey.completed')`)).limit(1);
    if (seen.length) continue;
    await emitEvent({ type: "journey.abandoned", agentId: c.agentId, conversationId: c.conversationId, journeyType: st.journeyKey, outcome: "abandoned", attributes: { journey: st.journeyKey } });
    out.abandoned++;
  }

  // 3) Callback SLA: escalations older than the SLA with no resolution → breach.
  const cbCut = new Date(now - CALLBACK_SLA_MIN * 60_000);
  const oldCallbacks = await db.select().from(escalations).where(lt(escalations.createdAt, cbCut));
  for (const e of oldCallbacks) {
    const seen = await db.select({ id: analyticsEvents.id }).from(analyticsEvents).where(and(eq(analyticsEvents.type, "sla_breach_detected"), sql`${analyticsEvents.attributes} ->> 'escalationId' = ${e.id}`)).limit(1);
    if (seen.length) continue;
    await emitEvent({ type: "sla_breach_detected", agentId: e.agentId, conversationId: e.conversationId, referenceId: e.externalRef ?? undefined, outcome: "callback_overdue", attributes: { escalationId: e.id, kind: "callback", ageMinutes: Math.round((now - new Date(e.createdAt).getTime()) / 60000) } });
    out.callbackBreaches++;
  }

  return NextResponse.json({ ok: true, ...out });
}

export async function GET() {
  return NextResponse.json({ info: "POST to run reconciliation (cron). Sweeps orphaned payments, SLA breaches, abandoned journeys." });
}
