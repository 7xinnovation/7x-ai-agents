import { listAgentsForFilter } from "@/lib/metrics";
import { currentScope, selectAgent } from "@/lib/scope";
import { AgentFilter } from "../AgentFilter";
import { apiCallStats, apiCallsByEndpoint, listApiCalls } from "@/lib/apiCallLog";
import { ApiLogsClient } from "./ApiLogsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every call the agents make to somebody else's API, and how it went.
 *
 * Asked for on 21 October: which endpoints are being called, which succeed and
 * which fail, separately for each agent. The rows come from `api_calls`, written
 * by `executeOperation` — the one door every integration tool goes through — so
 * a failing Emirates Post endpoint is visible here without reading the Azure
 * log stream, and a rise in 500s has somewhere to be seen.
 *
 * The agent selector is the same one the rest of the admin uses, which is what
 * keeps the two agents apart: `?agent=nxn-dialog` or `?agent=epgl-dialog`.
 */
export default async function ApiLogs({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; outcome?: string; q?: string; hours?: string }>;
}) {
  const sp = await searchParams;
  const agentList = await listAgentsForFilter();
  const scope = await currentScope();
  const selected = selectAgent(agentList, sp.agent, scope);

  const hours = Number(sp.hours ?? 24);
  const filter = {
    agentId: selected?.id,
    q: (sp.q ?? "").trim().slice(0, 100) || undefined,
    hours: Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 30) : 24,
  };
  const outcome = sp.outcome === "ok" || sp.outcome === "error" ? sp.outcome : "all";

  const [stats, rows, endpoints] = await Promise.all([
    apiCallStats(filter),
    listApiCalls({ ...filter, outcome, limit: 100 }),
    apiCallsByEndpoint(filter),
  ]);

  return (
    <>
      <header className="sa-top">
        <div>
          <h1>API Logs</h1>
          <p>
            Endpoint call history — which succeed, which fail, and what came back
            {selected ? ` · ${selected.name}` : " across all agents"}.
          </p>
        </div>
        <AgentFilter agents={agentList} allowAll={!scope} />
      </header>

      <ApiLogsClient
        agent={selected?.slug ?? ""}
        initial={{ stats, rows: rows.map(serialise), endpoints }}
        outcome={outcome}
        q={filter.q ?? ""}
        hours={filter.hours}
      />
    </>
  );
}

/** Dates do not survive the boundary to a client component; send them as ISO. */
function serialise<T extends { createdAt: Date | string }>(r: T) {
  return { ...r, createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString() };
}
