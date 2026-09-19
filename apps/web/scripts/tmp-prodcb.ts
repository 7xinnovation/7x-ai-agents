/** READ-ONLY. Does the production EPGL integration user have the Callback record type? */
import { epglAuth } from "../lib/epglRead";
import { getAgentBySlug } from "../lib/agents";
import type { EnvKey } from "../lib/integrations";

async function main() {
  const agent = await getAgentBySlug("epgl-dialog");
  if (!agent) throw new Error("no epgl-dialog");
  const env = (agent.definition.activeEnvironment ?? "production") as EnvKey;
  const auth = await epglAuth(agent.id, env);
  console.log(`env=${env} instance=${auth.baseUrl}`);
  const me = await fetch(`${auth.baseUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${auth.bearer}` } });
  const mj = (await me.json()) as any;
  console.log(`integration user: ${mj.preferred_username ?? JSON.stringify(mj).slice(0, 120)}`);
  const d = await fetch(`${auth.baseUrl}/services/data/v62.0/sobjects/Case/describe`, {
    headers: { Authorization: `Bearer ${auth.bearer}`, Accept: "application/json" },
  });
  if (!d.ok) { console.log(`Case describe -> HTTP ${d.status} ${(await d.text()).slice(0, 200)}`); return; }
  const dj = (await d.json()) as any;
  console.log(`Case createable=${dj.createable}`);
  const cb = (dj.recordTypeInfos ?? []).find((r: any) => String(r.name).toLowerCase() === "callback");
  console.log(`Callback record type: ${cb ? `${cb.recordTypeId} available=${cb.available}` : "NOT PRESENT"}`);
  console.log(`available types: ${(dj.recordTypeInfos ?? []).filter((r: any) => r.available).map((r: any) => r.name).join(", ")}`);
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
