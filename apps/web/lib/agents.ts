import { getDb, agents } from "@dialog/db";
import { AgentDefinition } from "@dialog/config";
import { eq } from "drizzle-orm";

export interface LoadedAgent {
  id: string;
  status: string;
  definition: AgentDefinition;
}

/** Load and validate an agent by its public slug. Returns null if not found. */
export async function getAgentBySlug(slug: string): Promise<LoadedAgent | null> {
  const db = getDb();
  const row = await db.query.agents.findFirst({ where: eq(agents.slug, slug) });
  if (!row) return null;
  // Validate the stored definition so a malformed config fails loudly.
  const definition = AgentDefinition.parse(row.definition);
  return { id: row.id, status: row.status, definition };
}

/** Load and validate an agent by its internal id (used by jobs/reconciliation). */
export async function getAgentById(id: string): Promise<LoadedAgent | null> {
  const db = getDb();
  const row = await db.query.agents.findFirst({ where: eq(agents.id, id) });
  if (!row) return null;
  const definition = AgentDefinition.parse(row.definition);
  return { id: row.id, status: row.status, definition };
}
