import { NextRequest, NextResponse } from "next/server";
import { currentScope, withinScope, denyAgent } from "@/lib/scope";
import { z } from "zod";
import { AgentDefinition } from "@dialog/config";
import { getDb, agents, tenants } from "@dialog/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

// NOTE: admin endpoints are unauthenticated in this scaffold. Put them behind
// auth (and an allowlist) before any non-local deployment.

/** List all agents with their tenant + status (for the admin console). */
export async function GET() {
  const db = getDb();
  const rows = await db
    .select({
      slug: agents.slug,
      name: agents.name,
      status: agents.status,
      tenantSlug: tenants.slug,
      tenantName: tenants.name,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .leftJoin(tenants, eq(agents.tenantId, tenants.id))
    .orderBy(agents.slug);
  return NextResponse.json({ agents: withinScope(rows, await currentScope()) });
}

const UpsertBody = z.object({
  definition: AgentDefinition,
  status: z.enum(["draft", "live", "disabled"]).default("draft"),
  tenantName: z.string().min(1),
});

/** Create or update an agent (and its tenant) from a validated definition. */
export async function POST(req: NextRequest) {
  const parsed = UpsertBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { definition, status, tenantName } = parsed.data;
  // Writing an agent is still acting on one: a scoped account may only write
  // the agents it can see, and may not create new ones.
  const denied = await denyAgent(definition.slug);
  if (denied) return denied;
  const db = getDb();

  const [tenant] = await db
    .insert(tenants)
    .values({ slug: definition.tenantSlug, name: tenantName })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: tenantName } })
    .returning();

  await db
    .insert(agents)
    .values({
      tenantId: tenant!.id,
      slug: definition.slug,
      name: definition.name,
      status,
      definition,
    })
    .onConflictDoUpdate({
      target: agents.slug,
      set: { definition, name: definition.name, status, tenantId: tenant!.id, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true, slug: definition.slug });
}
