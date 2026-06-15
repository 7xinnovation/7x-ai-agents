import Link from "next/link";
import { sql, desc, eq } from "drizzle-orm";
import { getDb, agents, tenants, conversations, messages, kbChunks, escalations, auditLog } from "@dialog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(table: any): Promise<number> {
  const [row] = await getDb().select({ c: sql<number>`count(*)::int` }).from(table);
  return row?.c ?? 0;
}

function timeAgo(d: Date | string) {
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - t.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function Overview() {
  const db = getDb();
  const [nAgents, nTenants, nConv, nMsg, nKb, nEsc] = await Promise.all([
    count(agents),
    count(tenants),
    count(conversations),
    count(messages),
    count(kbChunks),
    count(escalations),
  ]);

  const recent = await db
    .select({
      action: auditLog.action,
      actor: auditLog.actor,
      createdAt: auditLog.createdAt,
      payload: auditLog.payload,
      agentName: agents.name,
    })
    .from(auditLog)
    .leftJoin(agents, eq(auditLog.agentId, agents.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(8);

  const liveAgents = await db
    .select({ slug: agents.slug, name: agents.name, status: agents.status, tenantName: tenants.name, definition: agents.definition })
    .from(agents)
    .leftJoin(tenants, eq(agents.tenantId, tenants.id))
    .orderBy(desc(agents.updatedAt))
    .limit(5);

  const stats = [
    { label: "Agents", value: nAgents, hint: `${nTenants} tenants` },
    { label: "Conversations", value: nConv, hint: `${nMsg} messages` },
    { label: "Knowledge chunks", value: nKb, hint: "grounding" },
    { label: "Escalations", value: nEsc, hint: "to humans" },
  ];

  return (
    <>
      <header className="sa-top">
        <div>
          <h1>Overview</h1>
          <p>Your conversational agents at a glance.</p>
        </div>
        <Link className="sa-btn primary" href="/admin/new">
          New agent
        </Link>
      </header>

      <div className="sa-stats">
        {stats.map((s) => (
          <div className="sa-stat" key={s.label}>
            <span className="sa-stat-label">{s.label}</span>
            <span className="sa-stat-value">{s.value}</span>
            <span className="sa-stat-hint">{s.hint}</span>
          </div>
        ))}
      </div>

      <div className="sa-cols">
        <section className="sa-panel">
          <div className="sa-panel-head">
            <h2>Agents</h2>
            <Link href="/admin/agents">View all</Link>
          </div>
          <div className="sa-list">
            {liveAgents.map((a) => {
              const primary = (a.definition as { theme?: { colors?: { primary?: string } } })?.theme?.colors?.primary ?? "#1330F0";
              return (
                <Link href={`/admin/${a.slug}`} className="sa-listrow" key={a.slug}>
                  <span className="sa-chip-avatar" style={{ background: primary }}>
                    {a.name.charAt(0)}
                  </span>
                  <span className="sa-listrow-main">
                    <span className="sa-listrow-name">{a.name}</span>
                    <span className="sa-listrow-sub">{a.tenantName}</span>
                  </span>
                  <span className={`sa-status ${a.status}`}>{a.status}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="sa-panel">
          <div className="sa-panel-head">
            <h2>Recent activity</h2>
            <Link href="/admin/activity">View all</Link>
          </div>
          <div className="sa-feed">
            {recent.length === 0 ? <p className="sa-empty-line">No activity yet.</p> : null}
            {recent.map((r, i) => (
              <div className="sa-feeditem" key={i}>
                <span className={`sa-dot ${r.action.includes("submit") ? "ok" : r.action.includes("escal") ? "warn" : ""}`} />
                <span className="sa-feed-main">
                  <strong>{r.action.replace(/_/g, " ")}</strong>
                  <span className="sa-feed-sub">
                    {r.agentName ?? "—"} · {r.actor}
                  </span>
                </span>
                <span className="sa-feed-time">{timeAgo(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
