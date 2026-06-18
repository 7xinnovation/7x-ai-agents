import { getDb } from "@dialog/db";
import { sql } from "drizzle-orm";

/**
 * Analytics aggregation for the admin dashboards (PRD: KPI, Conversation,
 * Journey, Escalation, SLA, Operational monitoring). All metrics derive from the
 * standardized analytics_events stream within a rolling window.
 */
export interface Dashboards {
  windowDays: number;
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

export async function loadDashboards(windowDays = 30): Promise<Dashboards> {
  const since = sql.raw(`now() - interval '${Math.max(1, Math.min(365, windowDays))} days'`);

  const countRows = await rows<{ type: string; n: number }>(sql`SELECT type, count(*)::int AS n FROM analytics_events WHERE created_at >= ${since} GROUP BY type`);
  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.type] = Number(r.n);
  const c = (t: string) => counts[t] ?? 0;

  const intents = await rows<{ intent: string; count: number }>(sql`SELECT coalesce(attributes->>'intent','unknown') AS intent, count(*)::int AS count FROM analytics_events WHERE type='intent.identified' AND created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
  const languages = await rows<{ language: string; count: number }>(sql`SELECT coalesce(attributes->>'language','—') AS language, count(*)::int AS count FROM analytics_events WHERE type='conversation.started' AND created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC`);
  const customerTypes = await rows<{ type: string; count: number }>(sql`SELECT coalesce(attributes->>'customer_type','unknown') AS type, count(*)::int AS count FROM analytics_events WHERE type='intent.identified' AND created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC`);

  const jStarted = await rows<{ journey: string; n: number }>(sql`SELECT coalesce(attributes->>'journey','—') AS journey, count(*)::int AS n FROM analytics_events WHERE type='journey.started' AND created_at >= ${since} GROUP BY 1`);
  const jCompleted = await rows<{ journey: string; n: number }>(sql`SELECT coalesce(attributes->>'journey','—') AS journey, count(*)::int AS n FROM analytics_events WHERE type='journey.completed' AND created_at >= ${since} GROUP BY 1`);
  const jAbandoned = await rows<{ journey: string; n: number }>(sql`SELECT coalesce(attributes->>'journey','—') AS journey, count(*)::int AS n FROM analytics_events WHERE type='journey.abandoned' AND created_at >= ${since} GROUP BY 1`);
  const jmap = new Map<string, { started: number; completed: number; abandoned: number }>();
  for (const r of jStarted) jmap.set(r.journey, { started: Number(r.n), completed: 0, abandoned: 0 });
  for (const r of jCompleted) { const e = jmap.get(r.journey) ?? { started: 0, completed: 0, abandoned: 0 }; e.completed = Number(r.n); jmap.set(r.journey, e); }
  for (const r of jAbandoned) { const e = jmap.get(r.journey) ?? { started: 0, completed: 0, abandoned: 0 }; e.abandoned = Number(r.n); jmap.set(r.journey, e); }
  const journeys = [...jmap.entries()].map(([journey, v]) => ({ journey, ...v, rate: v.started ? Math.round((v.completed / v.started) * 100) : 0 })).sort((a, b) => b.started - a.started);

  const slaRows = await rows<{ kind: string; n: number }>(sql`SELECT coalesce(attributes->>'kind','other') AS kind, count(*)::int AS n FROM analytics_events WHERE type='sla_breach_detected' AND created_at >= ${since} GROUP BY 1`);
  const slaMap: Record<string, number> = {}; for (const r of slaRows) slaMap[r.kind] = Number(r.n);

  const volume = await rows<{ day: string; count: number }>(sql`SELECT to_char(date_trunc('day', created_at),'Mon DD') AS day, count(*)::int AS count FROM analytics_events WHERE created_at >= ${since} GROUP BY date_trunc('day', created_at) ORDER BY date_trunc('day', created_at)`);

  const journeysStarted = c("journey.started");
  const journeysCompleted = c("journey.completed");
  const abandoned = c("journey.abandoned");
  const payInit = c("payment.initiated");
  const payDone = c("payment.completed");
  const payFail = c("payment.failed");
  const conversations = c("conversation.started");
  const callbacks = c("callback.requested");

  return {
    windowDays,
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
      shipmentLookups: c("shipment.lookup"),
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
