/**
 * A2A discovery (specification §8.2): the Agent Card at the well-known path.
 * One host, one card — this deployment's default agent. Every agent's own card
 * is at /a2a/{agent}/agent-card.json.
 */
import { buildAgentCard, agentEntry, DEFAULT_AGENT_KEY } from "@/lib/a2a/catalogue";
import { jsonResponse, originOf } from "@/lib/a2a/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const entry = agentEntry(DEFAULT_AGENT_KEY)!;
  return jsonResponse(buildAgentCard(entry, originOf(req).origin), 200, {
    "cache-control": "public, max-age=300",
    etag: `"${entry.key}-${entry.version}"`,
    "access-control-allow-origin": "*",
  });
}
