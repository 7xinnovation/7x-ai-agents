import { getDb } from "@dialog/db";
import { currentScope, withinScope } from "@/lib/scope";
import { sql } from "drizzle-orm";

/**
 * Analytics aggregation for the admin dashboards (PRD: KPI, Conversation,
 * Journey, Escalation, SLA, Operational monitoring). Metrics derive from the
 * standardized analytics_events stream within a rolling window, optionally
 * scoped to a single agent. The "conversations" figure is counted from the
 * conversations table (source of truth) rather than the conversation.started
 * event, because a conversation can be created without a first message (e.g.
 * sign-in before the first turn) and would otherwise be undercounted.
 */
export interface Dashboards {
  windowDays: number;
  agentId: string | null;
  counts: Record<string, number>;
  kpis: {
    conversations: number;
    journeysStarted: number;
    journeysCompleted: number;
    journeyCompletionRate: number;
    abandonmentRate: number;
    paymentSuccessRate: number;
    selfServiceRate: number;
    knowledgeRetrievals: number;
    shipmentLookups: number;
    intentsClassified: number;
  };
  intents: { intent: string; count: number }[];
  languages: { language: string; count: number }[];
  customerTypes: { type: string; count: number }[];
  journeys: { journey: string; started: number; completed: number; abandoned: number; rate: number }[];
  escalations: { total: number; rate: number };
  sla: { total: number; payment: number; callback: number };
  volume: { day: string; count: number }[];
  payments: { initiated: number; completed: number; failed: number };
}

async function rows<T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = await getDb().execute(q);
  return ((res as unknown as { rows?: T[] }).rows ?? (res as unknown as T[])) ?? [];
}

/**
 * Agents available for the dashboard filter (id + label).
 *
 * Narrowed to the caller's agent scope, so a viewer limited to one agent is
 * never offered another in the picker — and, because every dashboard derives
 * its selection from this list, never reads one either.
 */
export async function listAgentsForFilter(): Promise<{ id: string; slug: string; name: string }[]> {
  const all = await rows<{ id: string; slug: string; name: string }>(
    sql`SELECT id, slug, name FROM agents ORDER BY name`
  );
  return withinScope(all, await currentScope());
}

export async function loadDashboards(windowDays = 30, agentId?: string | null): Promise<Dashboards> {
  const since = sql.raw(`now() - interval '${Math.max(1, Math.min(365, windowDays))} days'`);
  // Reusable scoping fragment. When an agent is selected every query is
  // constrained to it; otherwise they aggregate across all agents.
  const evAgent = agentId ? sql`AND agent_id = ${agentId}` : sql``;

  const countRows = await rows<{ type: string; n: number }>(sql`SELECT type, count(*)::int AS n FROM analytics_events WHERE created_at >= ${since} ${evAgent} GROUP BY type`);
  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.type] = Number(r.n);
  const c = (t: string) => counts[t] ?? 0;

  // Conversations: real rows from the source-of-truth table (agent-scoped).
  const convCountRow = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM conversations WHERE created_at >= ${since} ${evAgent}`);
  const conversations = Number(convCountRow[0]?.n ?? 0);

  const intents = await rows<{ intent: string; count: number }>(sql`SELECT coalesce(attributes->>'intent','unknown') AS intent, count(*)::int AS count FROM analytics_events WHERE type='intent.identified' AND created_at >= ${since} ${evAgent} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
  const languages = await rows<{ language: string; count: number }>(sql`SELECT coalesce(attributes->>'language','—') AS language, count(*)::int AS count FROM analytics_events WHERE type='conversation.started' AND created_at >= ${since} ${evAgent} GROUP BY 1 ORDER BY 2 DESC`);
  const customerTypes = await rows<{ type: string; count: number }>(sql`SELECT coalesce(attributes->>'customer_type','unknown') AS type, count(*)::int AS count FROM analytics_events WHERE type='intent.identified' AND created_at >= ${since} ${evAgent} GROUP BY 1 ORDER BY 2 DESC`);

  const jStarted = await rows<{ journey: string; n: number }>(sql`SELECT coalesce(attributes->>'journey','—') AS journey, count(*)::int AS n FROM analytics_events WHERE type='journey.started' AND created_at >= ${since} ${evAgent} GROUP BY 1`);
  const jCompleted = await rows<{ journey: string; n: number }>(sql`SELECT coalesce(attributes->>'journey','—') AS journey, count(*)::int AS n FROM analytics_events WHERE type='journey.completed' AND created_at >= ${since} ${evAgent} GROUP BY 1`);
  const jAbandoned = await rows<{ journey: string; n: number }>(sql`SELECT coalesce(attributes->>'journey','—') AS journey, count(*)::int AS n FROM analytics_events WHERE type='journey.abandoned' AND created_at >= ${since} ${evAgent} GROUP BY 1`);
  const jmap = new Map<string, { started: number; completed: number; abandoned: number }>();
  for (const r of jStarted) jmap.set(r.journey, { started: Number(r.n), completed: 0, abandoned: 0 });
  for (const r of jCompleted) { const e = jmap.get(r.journey) ?? { started: 0, completed: 0, abandoned: 0 }; e.completed = Number(r.n); jmap.set(r.journey, e); }
  for (const r of jAbandoned) { const e = jmap.get(r.journey) ?? { started: 0, completed: 0, abandoned: 0 }; e.abandoned = Number(r.n); jmap.set(r.journey, e); }
  const journeys = [...jmap.entries()].map(([journey, v]) => ({ journey, ...v, rate: v.started ? Math.round((v.completed / v.started) * 100) : 0 })).sort((a, b) => b.started - a.started);

  const slaRows = await rows<{ kind: string; n: number }>(sql`SELECT coalesce(attributes->>'kind','other') AS kind, count(*)::int AS n FROM analytics_events WHERE type='sla_breach_detected' AND created_at >= ${since} ${evAgent} GROUP BY 1`);
  const slaMap: Record<string, number> = {}; for (const r of slaRows) slaMap[r.kind] = Number(r.n);

  const volume = await rows<{ day: string; count: number }>(sql`SELECT to_char(date_trunc('day', created_at),'Mon DD') AS day, count(*)::int AS count FROM analytics_events WHERE created_at >= ${since} ${evAgent} GROUP BY date_trunc('day', created_at) ORDER BY date_trunc('day', created_at)`);

  const journeysStarted = c("journey.started");
  const journeysCompleted = c("journey.completed");
  const abandoned = c("journey.abandoned");
  /**
   * PAYMENTS COME FROM THE PAYMENTS TABLE, NOT THE EVENT STREAM.
   *
   * payment.completed is emitted by our own checkout's webhook. A journey that
   * pays on the BACKEND's gateway -- which is every Emirates Post renewal --
   * never goes through it, so the event was never written. Production on
   * 8 September: one settled payment of AED 695 in the payments table, and zero
   * payment.completed events. The card read "0 paid" for a rental somebody had
   * genuinely paid for.
   *
   * The payments table records both paths and is what the receipt is rendered
   * from, so it is the honest source. Counting it also repairs the figure
   * retroactively, which re-emitting events could not do without inventing
   * history that did not happen.
   */
  const payRows = await rows<{ status: string; n: number }>(
    sql`SELECT status, count(*)::int AS n FROM payments WHERE created_at >= ${since} ${evAgent} GROUP BY status`
  );
  const payByStatus: Record<string, number> = {};
  for (const r of payRows) payByStatus[r.status] = Number(r.n);
  const payDone = payByStatus.paid ?? 0;
  const payFail = payByStatus.failed ?? 0;
  // Every payment started, whatever became of it — a paid one was initiated too.
  const payInit = (payByStatus.initiated ?? 0) + payDone + payFail;
  const callbacks = c("callback.requested");

  return {
    windowDays,
    agentId: agentId ?? null,
    counts,
    kpis: {
      conversations,
      journeysStarted,
      journeysCompleted,
      journeyCompletionRate: journeysStarted ? Math.round((journeysCompleted / journeysStarted) * 100) : 0,
      abandonmentRate: journeysStarted ? Math.round((abandoned / journeysStarted) * 100) : 0,
      paymentSuccessRate: payInit ? Math.round((payDone / payInit) * 100) : 0,
      selfServiceRate: conversations ? Math.round(((conversations - callbacks) / conversations) * 100) : 0,
      knowledgeRetrievals: c("knowledge.retrieved"),
      // ASKED FOR, not looked up.
      //
      // shipment.lookup is emitted by a tool that does not exist, so this card
      // read 0 for ever while shipment tracking was the SECOND most common thing
      // anyone asked — 42 of thirty days' intents on production. A KPI that
      // cannot move is worse than no KPI: it says nothing is happening in the
      // one place that shows something is.
      //
      // The count is now the demand: how many people came here wanting a parcel
      // tracked. If a tracking tool is ever added, its lookups are added here
      // beside them.
      shipmentLookups:
        c("shipment.lookup") +
        Number(
          (
            await rows<{ n: number }>(
              sql`SELECT count(*)::int AS n FROM analytics_events WHERE type = 'intent.identified' AND attributes->>'intent' = 'shipment_tracking' AND created_at >= ${since} ${evAgent}`
            )
          )[0]?.n ?? 0
        ),
      intentsClassified: c("intent.identified"),
    },
    intents: intents.map((r) => ({ intent: r.intent, count: Number(r.count) })),
    languages: languages.map((r) => ({ language: r.language, count: Number(r.count) })),
    customerTypes: customerTypes.map((r) => ({ type: r.type, count: Number(r.count) })),
    journeys,
    escalations: { total: callbacks, rate: conversations ? Math.round((callbacks / conversations) * 100) : 0 },
    sla: { total: c("sla_breach_detected"), payment: slaMap.payment ?? 0, callback: slaMap.callback ?? 0 },
    volume: volume.map((r) => ({ day: r.day, count: Number(r.count) })),
    payments: { initiated: payInit, completed: payDone, failed: payFail },
  };
}
