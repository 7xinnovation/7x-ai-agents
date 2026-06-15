import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb, agents, auditLog } from "@dialog/db";
import { loadConversation } from "@/lib/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fmt(d: Date | string) {
  return new Date(d).toLocaleString();
}

export default async function ConversationView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadConversation(id);
  if (!data) notFound();

  const db = getDb();
  const [agent] = data.conversation.agentId
    ? await db.select({ name: agents.name, slug: agents.slug }).from(agents).where(eq(agents.id, data.conversation.agentId)).limit(1)
    : [];
  const events = await db
    .select({ action: auditLog.action, actor: auditLog.actor, payload: auditLog.payload, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(eq(auditLog.conversationId, id))
    .orderBy(desc(auditLog.createdAt));

  const cs = data.case;
  const dataEntries = Object.entries(cs.data ?? {});

  return (
    <>
      <header className="sa-top">
        <div>
          <h1>Conversation</h1>
          <p>
            <Link href="/admin/activity">Activity</Link> / {agent?.name ?? "—"} ·{" "}
            {data.conversation.locale.toUpperCase()} · {data.conversation.authenticated ? "authenticated" : "guest"} ·{" "}
            {fmt(data.conversation.createdAt)}
          </p>
        </div>
        {agent?.slug ? (
          <a className="sa-btn" href={`/embed/${agent.slug}`} target="_blank" rel="noreferrer">
            Open agent
          </a>
        ) : null}
      </header>

      <div className="sa-cols">
        <section className="sa-panel">
          <div className="sa-panel-head">
            <h2>Transcript</h2>
            <span className="sa-muted">{data.messages.length} messages</span>
          </div>
          {data.messages.length === 0 ? (
            <p className="sa-empty-line">No messages.</p>
          ) : (
            <div className="sa-transcript">
              {data.messages.map((m, i) => (
                <div className={`sa-tmsg ${m.role}`} key={i}>
                  <div className="sa-tbubble">{m.content}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="sa-panel">
            <div className="sa-panel-head">
              <h2>Case</h2>
              <span className={`sa-status ${cs.status === "submitted" ? "live" : cs.status === "draft" ? "draft" : "disabled"}`}>{cs.status}</span>
            </div>
            {cs.reference ? (
              <div className="sa-kv">
                <span>Reference</span>
                <span>{cs.reference}</span>
              </div>
            ) : null}
            {cs.journeyKey ? (
              <div className="sa-kv">
                <span>Journey</span>
                <span>{cs.journeyKey}</span>
              </div>
            ) : null}
            {dataEntries.length === 0 ? (
              <p className="sa-empty-line">No data collected.</p>
            ) : (
              dataEntries.map(([k, v]) => (
                <div className="sa-kv" key={k}>
                  <span>{k}</span>
                  <span>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))
            )}
            {cs.documents?.length ? (
              <>
                <div className="sa-kv">
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>Documents</span>
                  <span />
                </div>
                {cs.documents.map((d) => (
                  <div className="sa-kv" key={d.key}>
                    <span>{d.key}</span>
                    <span>{d.status}</span>
                  </div>
                ))}
              </>
            ) : null}
          </section>

          <section className="sa-panel">
            <div className="sa-panel-head">
              <h2>Audited actions</h2>
              <span className="sa-muted">{events.length}</span>
            </div>
            {events.length === 0 ? (
              <p className="sa-empty-line">None.</p>
            ) : (
              <div className="sa-feed">
                {events.map((e, i) => {
                  const ref = (e.payload as { reference?: string })?.reference;
                  return (
                    <div className="sa-feeditem" key={i}>
                      <span className={`sa-dot ${e.action.includes("submit") ? "ok" : e.action.includes("escal") ? "warn" : ""}`} />
                      <span className="sa-feed-main">
                        <strong>{e.action.replace(/_/g, " ")}</strong>
                        <span className="sa-feed-sub">
                          {e.actor}
                          {ref ? ` · ${ref}` : ""}
                        </span>
                      </span>
                      <span className="sa-feed-time">{fmt(e.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
