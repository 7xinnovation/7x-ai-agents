import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, agents, tenants } from "@dialog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timeAgo(d: Date | string) {
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - t.getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function AgentsList() {
  const db = getDb();
  const rows = await db
    .select({
      slug: agents.slug,
      name: agents.name,
      status: agents.status,
      updatedAt: agents.updatedAt,
      tenantName: tenants.name,
      definition: agents.definition,
    })
    .from(agents)
    .leftJoin(tenants, eq(agents.tenantId, tenants.id))
    .orderBy(desc(agents.updatedAt));

  return (
    <>
      <header className="sa-top">
        <div>
          <h1>Agents</h1>
          <p>Every embeddable assistant across your tenants.</p>
        </div>
        <Link className="sa-btn primary" href="/admin/new">
          New agent
        </Link>
      </header>

      <div className="sa-panel">
        <div className="sa-table">
          <div className="sa-tr sa-th">
            <span>Agent</span>
            <span>Tenant</span>
            <span>Languages</span>
            <span>Status</span>
            <span>Updated</span>
            <span />
          </div>
          {rows.map((r) => {
            const def = r.definition as {
              theme?: { colors?: { primary?: string } };
              locales?: string[];
            };
            const primary = def?.theme?.colors?.primary ?? "#1330F0";
            const locales = (def?.locales ?? []).map((l) => l.toUpperCase()).join(" · ");
            return (
              <div className="sa-tr" key={r.slug}>
                <span className="sa-cell-agent">
                  <span className="sa-chip-avatar" style={{ background: primary }}>
                    {r.name.charAt(0)}
                  </span>
                  <span className="sa-listrow-main">
                    <Link className="sa-listrow-name" href={`/admin/${r.slug}`}>
                      {r.name}
                    </Link>
                    <span className="sa-slug">{r.slug}</span>
                  </span>
                </span>
                <span>{r.tenantName}</span>
                <span className="sa-muted">{locales || "—"}</span>
                <span>
                  <span className={`sa-status ${r.status}`}>{r.status}</span>
                </span>
                <span className="sa-muted">{timeAgo(r.updatedAt)}</span>
                <span className="sa-cell-actions">
                  <a href={`/embed/${r.slug}`} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <Link href={`/admin/${r.slug}`}>Edit</Link>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
