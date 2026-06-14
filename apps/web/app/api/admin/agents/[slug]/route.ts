import { NextRequest, NextResponse } from "next/server";
import { getDb, agents, tenants } from "@dialog/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

/** Load one agent's full definition + status + tenant name for editing. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const [row] = await db
    .select({
      slug: agents.slug,
      status: agents.status,
      definition: agents.definition,
      tenantName: tenants.name,
    })
    .from(agents)
    .leftJoin(tenants, eq(agents.tenantId, tenants.id))
    .where(eq(agents.slug, slug))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}
