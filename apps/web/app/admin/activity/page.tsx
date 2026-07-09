import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, conversations, agents, auditLog } from "@dialog/db";
import { listAgentsForFilter } from "@/lib/metrics";
import { AgentFilter } from "../AgentFilter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timeAgo(d: Date | string) {
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - t.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function Activity({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const db = getDb();
  const { agent } = await searchParams;
  const agentList = await listAgentsForFilter();
  const selected = agent ? agentList.find((a) => a.slug === agent) : undefined;

  const convs = await db
    .select({
      id: conversations.id,
      locale: conversations.locale,
      authenticated: conversations.authenticated,
      createdAt: conversations.createdAt,
      agentName: agents.name,
    })
    .from(conversations)
    .leftJoin(agents, eq(conversations.agentId, agents.id))
    .where(selected ? eq(conversations.agentId, selected.id) : undefined)
    .orderBy(desc(conversations.createdAt))
    .limit(12);

  const events = await db
    .select({
      action: auditLog.action,
      actor: auditLog.actor,
      payload: auditLog.payload,
      createdAt: auditLog.createdAt,
      agentName: agents.name,
    })
    .from(auditLog)
    .leftJoin(agents, eq(auditLog.agentId, agents.id))
    .where(selected ? eq(auditLog.agentId, selected.id) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(15);

  return (
    <>
      <header className="sa-top">
        <div>
          <h1>Activity</h1>
          <p>Conversations and audited actions{selected ? ` · ${selected.name}` : " across all agents"}.</p>
        </div>
        <AgentFilter agents={agentList} />
      </header>

      <div className="sa-cols">
        <section className="sa-panel">
          <div className="sa-panel-head">
            <h2>Recent conversations</h2>
            <span className="sa-muted">{convs.length}</span>
          </div>
          <div className="sa-feed">
            {convs.length === 0 ? <p className="sa-empty-line">No conversations yet.</p> : null}
            {convs.map((c) => (
              <Link className="sa-feeditem sa-feeditem-link" href={`/admin/conversations/${c.id}`} key={c.id}>
                <span className={`sa-dot ${c.authenticated ? "ok" : ""}`} />
                <span className="sa-feed-main">
                  <strong>{c.agentName ?? "—"}</strong>
                  <span className="sa-feed-sub">
                    {c.locale.toUpperCase()} · {c.authenticated ? "authenticated" : "guest"}
                  </span>
                </span>
                <span className="sa-feed-time">{timeAgo(c.createdAt)}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="sa-panel">
          <div className="sa-panel-head">
            <h2>Audit log</h2>
            <span className="sa-muted">{events.length}</span>
          </div>
          <div className="sa-feed">
            {events.length === 0 ? <p className="sa-empty-line">No audited actions yet.</p> : null}
            {events.map((e, i) => {
              const ref = (e.payload as { reference?: string })?.reference;
              return (
                <div className="sa-feeditem" key={i}>
                  <span className={`sa-dot ${e.action.includes("submit") ? "ok" : e.action.includes("escal") ? "warn" : ""}`} />
                  <span className="sa-feed-main">
                    <strong>{e.action.replace(/_/g, " ")}</strong>
                    <span className="sa-feed-sub">
                      {e.agentName ?? "—"} · {e.actor}
                      {ref ? ` · ${ref}` : ""}
                    </span>
                  </span>
                  <span className="sa-feed-time">{timeAgo(e.createdAt)}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
