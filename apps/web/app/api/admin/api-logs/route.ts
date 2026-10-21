import { NextResponse } from "next/server";
import { listAgentsForFilter } from "@/lib/metrics";
import { currentScope, selectAgent } from "@/lib/scope";
import { apiCallStats, apiCallsByEndpoint, listApiCalls, type Outcome } from "@/lib/apiCallLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The API Logs page, refreshed.
 *
 * Same data the server component renders on first paint, so the page can poll
 * without a navigation. Gated by the admin session (middleware), and scoped the
 * same way every other admin surface is: an account restricted to one agent
 * cannot widen the view by asking for another slug.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentList = await listAgentsForFilter();
  const scope = await currentScope();
  const selected = selectAgent(agentList, url.searchParams.get("agent") ?? undefined, scope);
  // No agent and no scope means every agent; a scoped account always resolves
  // to one of its own.
  const agentId = selected?.id;

  const o = url.searchParams.get("outcome");
  const outcome: Outcome = o === "ok" || o === "error" ? o : "all";
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100) || undefined;
  const hours = Number(url.searchParams.get("hours") ?? 24);
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw ? new Date(beforeRaw) : undefined;

  const filter = { agentId, q, hours: Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 30) : 24 };
  const [stats, rows, endpoints] = await Promise.all([
    apiCallStats(filter),
    listApiCalls({ ...filter, outcome, before: before && !Number.isNaN(before.getTime()) ? before : undefined, limit: 100 }),
    apiCallsByEndpoint(filter),
  ]);

  return NextResponse.json(
    { agent: selected?.slug ?? null, stats, rows, endpoints },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
