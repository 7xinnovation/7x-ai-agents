import { desc, eq } from "drizzle-orm";
import { getDb, agents, tenants } from "@dialog/db";
import { AgentsTable, type AgentRow } from "./AgentsTable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Agents() {
  const rows = (await getDb()
    .select({ slug: agents.slug, name: agents.name, status: agents.status, updatedAt: agents.updatedAt, tenant: tenants.name, definition: agents.definition })
    .from(agents).leftJoin(tenants, eq(agents.tenantId, tenants.id)).orderBy(desc(agents.updatedAt))) as any[];

  const data: AgentRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    status: r.status,
    tenant: r.tenant ?? "—",
    primary: r.definition?.theme?.colors?.primary ?? "#0020F5",
    locales: (r.definition?.locales ?? []).map((l: string) => l.toUpperCase()),
    journeys: r.definition?.journeys?.length ?? 0,
    updated: r.updatedAt ? new Date(r.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—",
  }));

  return <AgentsTable rows={data} />;
}
