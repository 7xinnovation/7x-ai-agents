import Link from "next/link";
import { getDb, agents, tenants } from "@dialog/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const db = getDb();
  const rows = await db
    .select({
      slug: agents.slug,
      name: agents.name,
      status: agents.status,
      tenantName: tenants.name,
    })
    .from(agents)
    .leftJoin(tenants, eq(agents.tenantId, tenants.id))
    .orderBy(agents.slug);

  return (
    <main className="admin">
      <div className="admin-bar">
        <div>
          <h1>Agents</h1>
          <p>Generate and configure embeddable assistants. Each row is one company-facing agent.</p>
        </div>
        <div className="admin-bar-actions">
          <a className="admin-btn" href="/api/admin/logout">
            Sign out
          </a>
          <Link className="admin-btn primary" href="/admin/new">
            New agent
          </Link>
        </div>
      </div>

      <div className="admin-table">
        <div className="admin-row admin-head">
          <span>Agent</span>
          <span>Tenant</span>
          <span>Status</span>
          <span>Links</span>
        </div>
        {rows.map((r) => (
          <div className="admin-row" key={r.slug}>
            <span>
              <Link className="admin-name" href={`/admin/${r.slug}`}>
                {r.name}
              </Link>
              <span className="admin-slug">{r.slug}</span>
            </span>
            <span>{r.tenantName}</span>
            <span>
              <span className={`admin-status ${r.status}`}>{r.status}</span>
            </span>
            <span className="admin-links">
              <a href={`/embed/${r.slug}`} target="_blank" rel="noreferrer">
                Open
              </a>
              <Link href={`/admin/${r.slug}`}>Edit</Link>
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
