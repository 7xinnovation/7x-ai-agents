import { getDb } from "@dialog/db";
import { currentScope, withinScope } from "@/lib/scope";
import { sql } from "drizzle-orm";

/**
 * The insights dashboard — what the service actually did, where it lost people,
 * and what it cost them.
 *
 * `metrics.ts` answers "how many events of each type", which is the shape of the
 * event stream rather than the shape of the service. This answers the questions
 * the business asks: how many licences went out, where in the journey customers
 * leave, which payments fail and why, what people asked for that we do not do.
 *
 * TWO RULES, BOTH LEARNED THE HARD WAY.
 *
 * 1. EVERY FIGURE HERE IS MEASURED. Nothing is modelled, estimated or filled in
 *    with a plausible number. A metric we cannot source yet is absent and named
 *    in `notInstrumented`, because a dashboard whose numbers are half real is
 *    worth less than one that is small and true — the reader cannot tell which
 *    half they are looking at.
 * 2. EVERY FIGURE HAS A PRIOR PERIOD. A count with nothing to compare it to
 *    cannot be acted on; the same window immediately before is the cheapest
 *    honest comparison and costs one extra FILTER on a query we already run.
 */

/** A measure this period against the same length of time immediately before. */
export interface Delta {
  now: number;
  prior: number;
  /** Percentage change, or null when the prior period was zero (undefined, not infinite). */
  pct: number | null;
}

export interface InsightsAgent {
  id: string;
  slug: string;
  name: string;
}

export interface Insights {
  windowDays: number;
  agent: InsightsAgent | null;
  headline: {
    conversations: Delta;
    completed: Delta;
    revenueAed: Delta;
    /** Completed as a share of started, in points — `pct` is the point difference. */
    completionRate: Delta;
  };
  /** Stable journey order: the colour each journey wears, everywhere on the page. */
  journeyKeys: string[];
  journeyLabel: Record<string, string>;
  daily: { day: string; byJourney: Record<string, number>; total: number }[];
  journeys: {
    key: string;
    started: number;
    completed: number;
    rate: number;
    abandoned: number;
    medianMinutes: number | null;
    topDropStep: string | null;
  }[];
  funnel: { step: string; note: string; now: number; prior: number; loss: number | null }[];
  facets: { key: string; label: string; rows: { value: string; count: number }[] }[];
  payments: {
    initiated: number;
    paid: number;
    failed: number;
    /** Started, never finished, and not recorded as a failure either. */
    abandoned: number;
    revenueAed: number;
    byProvider: { provider: string; attempts: number; paid: number; rate: number }[];
  };
  intents: { intent: string; count: number; scope: "in" | "out" | "unknown" }[];
  unknownRate: Delta;
  escalations: { total: number; rate: number; byReason: { reason: string; count: number }[] };
  knowledge: Delta;
  quality: {
    documentsUploaded: number;
    documentsRejected: number;
    apiCalls: number;
    apiErrorRate: number;
    apiMedianMs: number | null;
  };
  /** Conversations that came back on a later day rather than being restarted. */
  continuity: { resumed: number; of: number; rate: number };
  languages: { language: string; count: number }[];
  conversationsPerDay: { day: string; count: number }[];
  sla: { total: number; byKind: { kind: string; count: number }[] };
  /** Metrics on the shared design that we cannot source yet, named rather than faked. */
  notInstrumented: string[];
}

type Row = Record<string, unknown>;

async function rows<T = Row>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = await getDb().execute(q);
  return ((res as unknown as { rows?: T[] }).rows ?? (res as unknown as T[])) ?? [];
}

/**
 * One block of the page failing must not take the page with it.
 *
 * Every section below is independent, and a dashboard that renders eleven
 * sections and one "could not be read" line is a working dashboard. The old
 * analytics page was a single awaited object, so a column that had not been
 * migrated yet turned the whole route into a 500.
 */
async function safe<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

const n = (v: unknown) => Number(v ?? 0) || 0;

function delta(now: number, prior: number): Delta {
  return { now, prior, pct: prior > 0 ? Math.round(((now - prior) / prior) * 1000) / 10 : null };
}

/** A rate against a rate compares in POINTS, not percent — 71% from 64% is +7 pts. */
function rateDelta(now: number, prior: number): Delta {
  return { now, prior, pct: Math.round((now - prior) * 10) / 10 };
}

export async function listAgentsForFilter(): Promise<InsightsAgent[]> {
  const all = await rows<InsightsAgent>(sql`SELECT id, slug, name FROM agents ORDER BY name`);
  return withinScope(all, await currentScope());
}

/** Journey titles, intents and choice fields, read from the live agent definition. */
interface ChoiceField {
  key: string;
  label: string;
  /** Stored value -> the label a person would recognise. */
  options: Record<string, string>;
}

const en = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { en?: unknown }).en === "string") return (v as { en: string }).en;
  return null;
};

async function journeyMeta(agentId: string | null) {
  const defs = await rows<{
    definition: {
      journeys?: {
        key?: string;
        title?: unknown;
        intent?: string;
        steps?: { fields?: { key?: string; label?: unknown; type?: string; options?: { value?: string; label?: unknown }[] }[] }[];
      }[];
    };
  }>(agentId ? sql`SELECT definition FROM agents WHERE id = ${agentId}` : sql`SELECT definition FROM agents`);

  const label: Record<string, string> = {};
  const intents = new Set<string>();
  /**
   * ONLY DECLARED CHOICES BECOME A BREAKDOWN.
   *
   * The first version of this discovered its own facets — any collected field
   * with few enough distinct answers got a card. On staging that put three
   * customers' email addresses and four of their phone numbers on an admin
   * dashboard, because a handful of test runs share a handful of contacts. The
   * rule that let them through was a volume accident, not a safeguard: it would
   * have "fixed itself" under real traffic, which is the worst way for a privacy
   * bug to behave.
   *
   * A field the journey declares with `options` (or as a yes/no) is a field whose
   * entire value space is known in advance and contains nobody's details. Those,
   * and nothing else, are breakable down.
   */
  const choices = new Map<string, ChoiceField>();
  for (const d of defs) {
    for (const j of d.definition?.journeys ?? []) {
      if (!j?.key) continue;
      label[j.key] = en(j.title) || j.key;
      if (j.intent) intents.add(j.intent);
      for (const step of j.steps ?? []) {
        for (const f of step.fields ?? []) {
          if (!f?.key || choices.has(f.key)) continue;
          if (f.options?.length) {
            const options: Record<string, string> = {};
            for (const o of f.options) if (o?.value) options[o.value] = en(o.label) || o.value;
            choices.set(f.key, { key: f.key, label: en(f.label) || f.key, options });
          } else if (f.type === "boolean") {
            choices.set(f.key, { key: f.key, label: en(f.label) || f.key, options: { true: "Yes", false: "No" } });
          }
        }
      }
    }
  }
  return { label, intents, choices };
}

export async function loadInsights(windowDays = 30, agentId?: string | null): Promise<Insights> {
  const d = Math.max(1, Math.min(365, windowDays));
  const from = sql.raw(`now() - interval '${d} days'`);
  const priorFrom = sql.raw(`now() - interval '${d * 2} days'`);
  const id = agentId ?? null;
  // `agent_id` is spelled the same on every table this file reads, so one
  // fragment scopes them all.
  const scoped = id ? sql`AND agent_id = ${id}` : sql``;

  const agentRow = id
    ? (await rows<InsightsAgent>(sql`SELECT id, slug, name FROM agents WHERE id = ${id}`))[0] ?? null
    : null;
  const meta = await safe(
    { label: {} as Record<string, string>, intents: new Set<string>(), choices: new Map<string, ChoiceField>() },
    () => journeyMeta(id)
  );
  const notInstrumented: string[] = [];

  /* ---------------------------------------------------------------- headline */

  const headline = await safe(
    {
      conversations: delta(0, 0),
      completed: delta(0, 0),
      revenueAed: delta(0, 0),
      completionRate: rateDelta(0, 0),
    },
    async () => {
      const conv = (
        await rows<{ now: number; prior: number }>(sql`
          SELECT count(*) FILTER (WHERE created_at >= ${from})::int AS now,
                 count(*) FILTER (WHERE created_at < ${from})::int AS prior
          FROM conversations WHERE created_at >= ${priorFrom} ${scoped}`)
      )[0];

      const jr = (
        await rows<{ type: string; now: number; prior: number }>(sql`
          SELECT type,
                 count(*) FILTER (WHERE created_at >= ${from})::int AS now,
                 count(*) FILTER (WHERE created_at < ${from})::int AS prior
          FROM analytics_events
          WHERE type IN ('journey.started','journey.completed') AND created_at >= ${priorFrom} ${scoped}
          GROUP BY type`)
      ).reduce<Record<string, { now: number; prior: number }>>((acc, r) => {
        acc[r.type] = { now: n(r.now), prior: n(r.prior) };
        return acc;
      }, {});
      const started = jr["journey.started"] ?? { now: 0, prior: 0 };
      const done = jr["journey.completed"] ?? { now: 0, prior: 0 };

      const rev = (
        await rows<{ now: number; prior: number }>(sql`
          SELECT coalesce(sum(amount) FILTER (WHERE created_at >= ${from}), 0)::float8 AS now,
                 coalesce(sum(amount) FILTER (WHERE created_at < ${from}), 0)::float8 AS prior
          FROM payments WHERE status = 'paid' AND created_at >= ${priorFrom} ${scoped}`)
      )[0];

      const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
      return {
        conversations: delta(n(conv?.now), n(conv?.prior)),
        completed: delta(done.now, done.prior),
        revenueAed: delta(Math.round(n(rev?.now)), Math.round(n(rev?.prior))),
        completionRate: rateDelta(pct(done.now, started.now), pct(done.prior, started.prior)),
      };
    }
  );

  /* -------------------------------------------------------- completions/day */

  /**
   * THE AXIS COMES FROM THE CALENDAR, NOT FROM THE DATA.
   *
   * Grouping events by day gives you only the days something happened, and a bar
   * chart drawn from those is a lie with a straight face: four completions on
   * four scattered days render as four adjacent columns that read as a steady
   * week. The window's every day is generated first and the counts are dropped
   * into it, so a quiet Tuesday is visible as a gap.
   */
  const dayAxis = await safe<string[]>([], () =>
    rows<{ day: string }>(sql`
      SELECT to_char(g.d, 'Mon DD') AS day
      FROM generate_series(date_trunc('day', ${from}), date_trunc('day', now()), interval '1 day') AS g(d)
      ORDER BY g.d`).then((r) => r.map((x) => x.day))
  );

  const dailyRows = await safe<{ day: string; journey: string; count: number }[]>([], () =>
    rows(sql`
      SELECT to_char(date_trunc('day', created_at), 'Mon DD') AS day,
             coalesce(attributes->>'journey', '—') AS journey,
             count(*)::int AS count
      FROM analytics_events
      WHERE type = 'journey.completed' AND created_at >= ${from} ${scoped}
      GROUP BY date_trunc('day', created_at), 2
      ORDER BY date_trunc('day', created_at)`)
  );

  /* ------------------------------------------------------ journey performance */

  const journeys = await safe<Insights["journeys"]>([], async () => {
    const counts = await rows<{ journey: string; type: string; n: number }>(sql`
      SELECT coalesce(attributes->>'journey', '—') AS journey, type, count(*)::int AS n
      FROM analytics_events
      WHERE type IN ('journey.started','journey.completed')
        AND created_at >= ${from} ${scoped}
      GROUP BY 1, 2`);

    /**
     * ABANDONMENT, MEASURED RATHER THAN WAITED FOR.
     *
     * `journey.abandoned` exists and is emitted — by the reconciliation sweep,
     * for journeys that reached a payment. Everything that falls over before the
     * payment, which is most of what falls over, never gets the event, and the
     * column read 0 on every journey on both agents while two thirds of starts
     * were going nowhere.
     *
     * So it is asked of the conversation directly: a journey that started, never
     * completed, and has been silent for half an hour. The same definition as the
     * shared design, and it works on history instead of only on journeys started
     * after some future deploy.
     */
    const abandonedRows = await rows<{ journey: string; n: number }>(sql`
      SELECT coalesce(s.attributes->>'journey', '—') AS journey,
             count(DISTINCT s.conversation_id)::int AS n
      FROM analytics_events s
      WHERE s.type = 'journey.started' AND s.created_at >= ${from} ${id ? sql`AND s.agent_id = ${id}` : sql``}
        AND NOT EXISTS (
          SELECT 1 FROM analytics_events c
          WHERE c.conversation_id = s.conversation_id AND c.type = 'journey.completed'
        )
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.conversation_id = s.conversation_id AND m.created_at > now() - interval '30 minutes'
        )
      GROUP BY 1`);
    const abandonedBy = new Map(abandonedRows.map((r) => [r.journey, n(r.n)]));

    /**
     * How long a finished journey took, from the inside.
     *
     * Per conversation, the first start to the first completion — not the last,
     * because a customer who starts a second application in the same chat would
     * otherwise be timed from their first word to their second licence.
     */
    const medians = await rows<{ journey: string; median: number }>(sql`
      SELECT journey, percentile_cont(0.5) WITHIN GROUP (ORDER BY mins)::float8 AS median
      FROM (
        SELECT coalesce(s.attributes->>'journey', '—') AS journey,
               extract(epoch FROM (min(c.created_at) - min(s.created_at))) / 60 AS mins
        FROM analytics_events s
        JOIN analytics_events c
          ON c.conversation_id = s.conversation_id
         AND c.type = 'journey.completed'
         AND c.created_at >= s.created_at
        WHERE s.type = 'journey.started' AND s.created_at >= ${from} ${id ? sql`AND s.agent_id = ${id}` : sql``}
        GROUP BY s.conversation_id, 1
      ) t
      WHERE mins >= 0
      GROUP BY journey`);
    const medianBy = new Map(medians.map((r) => [r.journey, n(r.median)]));

    /**
     * WHERE THEY STOPPED, from the case rather than the event stream.
     *
     * There is no "step abandoned" event and inventing one would only describe
     * journeys started after it shipped. The case already records the step it was
     * sitting on when it went quiet, so the unfinished ones answer this directly
     * and answer it for history too.
     */
    const drops = await rows<{ journey: string; step: string; n: number }>(sql`
      SELECT coalesce(state->>'journeyKey', '—') AS journey,
             coalesce(state->>'currentStep', '—') AS step,
             count(*)::int AS n
      FROM cases
      WHERE created_at >= ${from}
        AND coalesce(state->'readiness'->>'complete', 'false') <> 'true'
        ${scoped}
      GROUP BY 1, 2`);
    const topDrop = new Map<string, { step: string; n: number }>();
    for (const r of drops) {
      const best = topDrop.get(r.journey);
      if (!best || n(r.n) > best.n) topDrop.set(r.journey, { step: r.step, n: n(r.n) });
    }

    const by = new Map<string, { started: number; completed: number; abandoned: number }>();
    for (const r of counts) {
      const e = by.get(r.journey) ?? { started: 0, completed: 0, abandoned: 0 };
      if (r.type === "journey.started") e.started = n(r.n);
      if (r.type === "journey.completed") e.completed = n(r.n);
      by.set(r.journey, e);
    }
    for (const [journey, count] of abandonedBy) {
      const e = by.get(journey) ?? { started: 0, completed: 0, abandoned: 0 };
      e.abandoned = count;
      by.set(journey, e);
    }
    return [...by.entries()]
      .map(([key, v]) => ({
        key,
        ...v,
        rate: v.started ? Math.round((v.completed / v.started) * 100) : 0,
        medianMinutes: medianBy.has(key) ? Math.round((medianBy.get(key) as number) * 10) / 10 : null,
        topDropStep: topDrop.get(key)?.step ?? null,
      }))
      .sort((a, b) => b.started - a.started);
  });

  /* ------------------------------------------------------------------ funnel */

  const funnel = await safe<Insights["funnel"]>([], async () => {
    /**
     * Every rung counts CONVERSATIONS, distinctly.
     *
     * Mixing a row count into a funnel is how a stage ends up wider than the one
     * above it: three payment attempts in one chat is one conversation that
     * reached payment, not three.
     */
    const pair = async (q: ReturnType<typeof sql>) => {
      const r = (await rows<{ now: number; prior: number }>(q))[0];
      return { now: n(r?.now), prior: n(r?.prior) };
    };
    const ev = (where: ReturnType<typeof sql>) => sql`
      SELECT count(DISTINCT conversation_id) FILTER (WHERE created_at >= ${from})::int AS now,
             count(DISTINCT conversation_id) FILTER (WHERE created_at < ${from})::int AS prior
      FROM analytics_events WHERE created_at >= ${priorFrom} ${scoped} AND ${where}`;

    const conversations = await pair(sql`
      SELECT count(*) FILTER (WHERE created_at >= ${from})::int AS now,
             count(*) FILTER (WHERE created_at < ${from})::int AS prior
      FROM conversations WHERE created_at >= ${priorFrom} ${scoped}`);
    const recognised = await pair(ev(sql`type = 'intent.identified' AND coalesce(attributes->>'intent','unknown') <> 'unknown'`));
    const started = await pair(ev(sql`type = 'journey.started'`));
    const complete = await pair(sql`
      SELECT count(DISTINCT conversation_id) FILTER (WHERE created_at >= ${from})::int AS now,
             count(DISTINCT conversation_id) FILTER (WHERE created_at < ${from})::int AS prior
      FROM cases
      WHERE created_at >= ${priorFrom} ${scoped} AND state->'readiness'->>'complete' = 'true'`);
    const filed = await pair(ev(sql`type = 'crm.case.created'`));
    const confirmed = await pair(ev(sql`type = 'journey.completed'`));

    /**
     * PAYMENT IS NOT A RUNG ON THIS LADDER.
     *
     * It was, and it made the chart go backwards: EPGL filed 11 applications and
     * confirmed 11 of them while only 6 payments settled here, so "Confirmed"
     * came out 83% WIDER than "Paid" — a funnel that widens is not a funnel, it
     * is two different populations drawn on one axis. The journeys disagree about
     * when money changes hands (a new licence files first and pays after; a PO Box
     * pays before it is confirmed) and some of them pay on a gateway this platform
     * never sees at all.
     *
     * So the funnel measures getting the request filed and confirmed, which every
     * journey does in the same order, and payment gets its own pipeline below —
     * where "raised, settled, declined, stuck" is the question actually worth
     * asking about it.
     */
    const steps: { step: string; note: string; now: number; prior: number }[] = [
      { step: "Conversations", note: "Every chat opened", ...conversations },
      { step: "Intent recognised", note: "The agent knew what they wanted", ...recognised },
      { step: "Journey started", note: "A journey was entered", ...started },
      { step: "Data complete", note: "Every required field and document in", ...complete },
      { step: "Filed", note: "A reference came back from the backend", ...filed },
      { step: "Confirmed", note: "The journey closed as complete", ...confirmed },
    ];
    return steps.map((s, i) => {
      const above = i === 0 ? null : (steps[i - 1]?.now ?? null);
      // A rung can still exceed the one above when an event went missing — say so
      // with a null rather than drawing a negative loss as if it were a gain.
      if (above == null || above <= 0 || s.now > above) return { ...s, loss: null };
      return { ...s, loss: Math.round(((s.now - above) / above) * 1000) / 10 };
    });
  });

  /* ------------------------------------------------------------------ facets */

  /**
   * WHAT CUSTOMERS CHOSE — the journey's own choice fields, counted.
   *
   * The keys come from the definition (see `journeyMeta`), so a journey that
   * gains an option gains a breakdown with it and nothing that holds a person's
   * details can ever appear here. Values are mapped back through the option
   * labels, because `MYHOME3` and `1_YEAR` are storage, not English.
   */
  const facets = await safe<Insights["facets"]>([], async () => {
    const keys = [...meta.choices.keys()];
    if (!keys.length) return [];
    const raw = await rows<{ key: string; value: string; n: number }>(sql`
      SELECT kv.key AS key, kv.value AS value, count(*)::int AS n
      FROM cases, LATERAL jsonb_each_text(
             CASE WHEN jsonb_typeof(state->'data') = 'object' THEN state->'data' ELSE '{}'::jsonb END
           ) AS kv
      WHERE created_at >= ${from} ${scoped}
        AND kv.key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
        AND kv.value <> ''
      GROUP BY 1, 2`);

    /**
     * A yes/no field does not store a boolean.
     *
     * `save_card_consent` holds "yes" from one route and "Yes" from another, and
     * the raw values rendered as two separate bars — 8 and 1 — of the same
     * answer. The declared value space is two answers, so two is what it shows.
     */
    const YES = new Set(["true", "yes", "y", "1", "accepted"]);
    const NO = new Set(["false", "no", "n", "0"]);
    const readable = (field: ChoiceField, raw: string) => {
      const exact = field.options[raw];
      if (exact) return exact;
      const low = raw.trim().toLowerCase();
      if (field.options.true && YES.has(low)) return field.options.true;
      if (field.options.false && NO.has(low)) return field.options.false;
      return field.options[low] ?? raw;
    };

    const byKey = new Map<string, Map<string, number>>();
    for (const r of raw) {
      const field = meta.choices.get(r.key);
      if (!field) continue;
      const bucket = byKey.get(r.key) ?? new Map<string, number>();
      const value = readable(field, r.value);
      bucket.set(value, (bucket.get(value) ?? 0) + n(r.n));
      byKey.set(r.key, bucket);
    }
    return [...byKey.entries()]
      .map(([key, bucket]) => ({
        key,
        label: meta.choices.get(key)?.label ?? key,
        rows: [...bucket.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
      }))
      /**
       * A field where everyone gave the same answer is not a breakdown.
       *
       * "Declaration accepted: Yes 30" is a fact, and a true one, but it is a bar
       * chart with one bar — it tells the reader nothing they could act on. Those
       * sort last, so the three cards on the page are the three that actually
       * split, and the rest are still there if the page grows.
       */
      .sort((a, b) => {
        const split = (f: { rows: unknown[] }) => (f.rows.length > 1 ? 1 : 0);
        if (split(b) !== split(a)) return split(b) - split(a);
        return b.rows.reduce((t, r) => t + r.count, 0) - a.rows.reduce((t, r) => t + r.count, 0);
      })
      .slice(0, 6);
  });

  /* ---------------------------------------------------------------- payments */

  const payments = await safe<Insights["payments"]>(
    { initiated: 0, paid: 0, failed: 0, abandoned: 0, revenueAed: 0, byProvider: [] },
    async () => {
      const byStatus = await rows<{ status: string; n: number; amount: number }>(sql`
        SELECT status, count(*)::int AS n, coalesce(sum(amount), 0)::float8 AS amount
        FROM payments WHERE created_at >= ${from} ${scoped} GROUP BY status`);
      const m: Record<string, number> = {};
      let revenue = 0;
      for (const r of byStatus) {
        m[r.status] = n(r.n);
        if (r.status === "paid") revenue = n(r.amount);
      }
      const paid = m.paid ?? 0;
      const failed = m.failed ?? 0;
      /**
       * STUCK, not failed. A payment the gateway never came back about is a
       * different problem from one it declined — the customer may well have been
       * charged — and the reconciliation sweep is what resolves it. Rolling the
       * two together hid 29 of them behind a 97% success rate.
       */
      const abandoned = m.initiated ?? 0;
      const byProvider = await rows<{ provider: string; attempts: number; paid: number }>(sql`
        SELECT coalesce(provider, 'default') AS provider,
               count(*)::int AS attempts,
               count(*) FILTER (WHERE status = 'paid')::int AS paid
        FROM payments WHERE created_at >= ${from} ${scoped}
        GROUP BY 1 ORDER BY 2 DESC`);
      return {
        initiated: paid + failed + abandoned,
        paid,
        failed,
        abandoned,
        revenueAed: Math.round(revenue),
        byProvider: byProvider.map((r) => ({
          provider: r.provider,
          attempts: n(r.attempts),
          paid: n(r.paid),
          rate: n(r.attempts) ? Math.round((n(r.paid) / n(r.attempts)) * 100) : 0,
        })),
      };
    }
  );

  /* ----------------------------------------------------------- demand/intent */

  const intents = await safe<Insights["intents"]>([], async () => {
    const list = await rows<{ intent: string; count: number }>(sql`
      SELECT coalesce(attributes->>'intent', 'unknown') AS intent, count(*)::int AS count
      FROM analytics_events
      WHERE type = 'intent.identified' AND created_at >= ${from} ${scoped}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 14`);
    return list.map((r) => ({
      intent: r.intent,
      count: n(r.count),
      // In scope means a journey of this agent answers it. Anything else is
      // demand we are not serving — which is the point of the card.
      scope: r.intent === "unknown" ? "unknown" : meta.intents.has(r.intent) ? "in" : "out",
    }));
  });

  const unknownRate = await safe(rateDelta(0, 0), async () => {
    const r = (
      await rows<{ n_now: number; u_now: number; n_prior: number; u_prior: number }>(sql`
        SELECT count(*) FILTER (WHERE created_at >= ${from})::int AS n_now,
               count(*) FILTER (WHERE created_at >= ${from} AND coalesce(attributes->>'intent','unknown') = 'unknown')::int AS u_now,
               count(*) FILTER (WHERE created_at < ${from})::int AS n_prior,
               count(*) FILTER (WHERE created_at < ${from} AND coalesce(attributes->>'intent','unknown') = 'unknown')::int AS u_prior
        FROM analytics_events
        WHERE type = 'intent.identified' AND created_at >= ${priorFrom} ${scoped}`)
    )[0];
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    return rateDelta(pct(n(r?.u_now), n(r?.n_now)), pct(n(r?.u_prior), n(r?.n_prior)));
  });

  /* -------------------------------------------------------------- escalation */

  const escalations = await safe<Insights["escalations"]>({ total: 0, rate: 0, byReason: [] }, async () => {
    const byReason = await rows<{ reason: string; n: number }>(sql`
      SELECT coalesce(nullif(trim(reason), ''), 'unspecified') AS reason, count(*)::int AS n
      FROM escalations WHERE created_at >= ${from} ${scoped}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
    const total = byReason.reduce((s, r) => s + n(r.n), 0);
    return {
      total,
      rate: headline.conversations.now ? Math.round((total / headline.conversations.now) * 1000) / 10 : 0,
      byReason: byReason.map((r) => ({ reason: r.reason, count: n(r.n) })),
    };
  });

  const knowledge = await safe(delta(0, 0), async () => {
    const r = (
      await rows<{ now: number; prior: number }>(sql`
        SELECT count(*) FILTER (WHERE created_at >= ${from})::int AS now,
               count(*) FILTER (WHERE created_at < ${from})::int AS prior
        FROM analytics_events WHERE type = 'knowledge.retrieved' AND created_at >= ${priorFrom} ${scoped}`)
    )[0];
    return delta(n(r?.now), n(r?.prior));
  });

  /* ----------------------------------------------------------------- quality */

  const quality = await safe<Insights["quality"]>(
    { documentsUploaded: 0, documentsRejected: 0, apiCalls: 0, apiErrorRate: 0, apiMedianMs: null },
    async () => {
      const docs = (
        await rows<{ uploaded: number; rejected: number }>(sql`
          SELECT count(*) FILTER (WHERE d.status IN ('uploaded','accepted'))::int AS uploaded,
                 count(*) FILTER (WHERE d.status = 'rejected')::int AS rejected
          FROM documents d
          JOIN cases c ON c.id = d.case_id
          WHERE d.created_at >= ${from} ${id ? sql`AND c.agent_id = ${id}` : sql``}`)
      )[0];
      const api = (
        await rows<{ total: number; bad: number; median: number }>(sql`
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE ok = false)::int AS bad,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::float8 AS median
          FROM api_calls WHERE created_at >= ${from} ${scoped}`)
      )[0];
      const total = n(api?.total);
      return {
        documentsUploaded: n(docs?.uploaded),
        documentsRejected: n(docs?.rejected),
        apiCalls: total,
        apiErrorRate: total ? Math.round((n(api?.bad) / total) * 1000) / 10 : 0,
        apiMedianMs: total ? Math.round(n(api?.median)) : null,
      };
    }
  );

  /**
   * CONTINUITY — the agentic-AI standard's "resumed, not restarted".
   *
   * Read as: a conversation that was still being used on a later calendar day
   * than it was opened. It is the honest reading of what we store; the standard's
   * own definition (a journey picked up from a previous session) needs a session
   * boundary we do not record, so the figure is named for what it measures.
   */
  const continuity = await safe<Insights["continuity"]>({ resumed: 0, of: 0, rate: 0 }, async () => {
    const r = (
      await rows<{ resumed: number; total: number }>(sql`
        SELECT count(*) FILTER (WHERE days > 1)::int AS resumed, count(*)::int AS total
        FROM (
          SELECT c.id, count(DISTINCT date_trunc('day', m.created_at)) AS days
          FROM conversations c
          JOIN messages m ON m.conversation_id = c.id
          WHERE c.created_at >= ${from} ${id ? sql`AND c.agent_id = ${id}` : sql``}
          GROUP BY c.id
        ) t`)
    )[0];
    const of = n(r?.total);
    const resumed = n(r?.resumed);
    return { resumed, of, rate: of ? Math.round((resumed / of) * 1000) / 10 : 0 };
  });

  /* ------------------------------------------------------------- operational */

  const languages = await safe<Insights["languages"]>([], () =>
    rows<{ language: string; count: number }>(sql`
      SELECT upper(coalesce(locale, '—')) AS language, count(*)::int AS count
      FROM conversations WHERE created_at >= ${from} ${scoped}
      GROUP BY 1 ORDER BY 2 DESC`).then((l) => l.map((r) => ({ language: r.language, count: n(r.count) })))
  );

  const conversationsRaw = await safe<{ day: string; count: number }[]>([], () =>
    rows<{ day: string; count: number }>(sql`
      SELECT to_char(date_trunc('day', created_at), 'Mon DD') AS day, count(*)::int AS count
      FROM conversations WHERE created_at >= ${from} ${scoped}
      GROUP BY date_trunc('day', created_at) ORDER BY date_trunc('day', created_at)`)
  );

  const sla = await safe<Insights["sla"]>({ total: 0, byKind: [] }, async () => {
    const byKind = await rows<{ kind: string; n: number }>(sql`
      SELECT coalesce(attributes->>'kind', 'other') AS kind, count(*)::int AS n
      FROM analytics_events
      WHERE type = 'sla_breach_detected' AND created_at >= ${from} ${scoped}
      GROUP BY 1 ORDER BY 2 DESC`);
    return { total: byKind.reduce((s, r) => s + n(r.n), 0), byKind: byKind.map((r) => ({ kind: r.kind, count: n(r.n) })) };
  });

  /* -------------------------------------------------------------- assembly */

  const dailyMap = new Map<string, Record<string, number>>();
  for (const r of dailyRows) {
    const bucket = dailyMap.get(r.day) ?? {};
    bucket[r.journey] = n(r.count);
    dailyMap.set(r.day, bucket);
  }
  const axis = dayAxis.length ? dayAxis : [...dailyMap.keys()];
  const daily = axis.map((day) => {
    const byJourney = dailyMap.get(day) ?? {};
    return { day, byJourney, total: Object.values(byJourney).reduce((t, v) => t + v, 0) };
  });

  /**
   * ONE COLOUR PER JOURNEY, FIXED FOR THE PAGE.
   *
   * The order is by volume and is computed once here, so a journey keeps its hue
   * in the stacked bars, the legend and the table. Deriving it per chart is how a
   * filter that drops one journey repaints all the others.
   */
  const journeyKeys = [
    ...new Set([...journeys.map((j) => j.key), ...dailyRows.map((r) => r.journey)]),
  ].filter((k) => k !== "—");

  const conversationCounts = new Map(conversationsRaw.map((r) => [r.day, n(r.count)]));
  const conversationsPerDay = (dayAxis.length ? dayAxis : conversationsRaw.map((r) => r.day)).map((day) => ({
    day,
    count: conversationCounts.get(day) ?? 0,
  }));

  const journeyLabel: Record<string, string> = {};
  for (const k of journeyKeys) journeyLabel[k] = meta.label[k] ?? k.replace(/_/g, " ");

  // Named, not invented. Each of these is on the shared design and has no feed.
  const distinctChannels = 1;
  if (distinctChannels < 2) notInstrumented.push("Channel mix (web / app / voice) — every event is written as `web`; the embed does not yet say which surface it is on.");
  notInstrumented.push("Customer Pulse score — the survey is minted per completed payment but the responses live in Customer Pulse, not here.");
  notInstrumented.push("Ask-once rate — we do not record which fields arrived pre-filled from UAE PASS or a document versus typed by the customer.");
  notInstrumented.push("Fields corrected at review — the review edit is applied in place, so the before-value is not kept.");

  return {
    windowDays: d,
    agent: agentRow,
    headline,
    journeyKeys,
    journeyLabel,
    daily,
    journeys,
    funnel,
    facets,
    payments,
    intents,
    unknownRate,
    escalations,
    knowledge,
    quality,
    continuity,
    languages,
    conversationsPerDay,
    sla,
    notInstrumented,
  };
}
