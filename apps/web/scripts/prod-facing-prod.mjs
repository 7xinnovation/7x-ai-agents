/**
 * Is production facing production?
 *
 * Names every host, key and URL the live agents would actually reach, so a
 * sandbox left in place is visible rather than inferred.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
const c = new pg.Client({ connectionString: /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(process.argv[2], "utf8"))[1] });
await c.connect();
const agents = (await c.query(`SELECT id, slug, status, definition FROM agents ORDER BY slug`)).rows;
const intgs = (await c.query(`SELECT agent_id, name, enabled, environments FROM agent_integrations`)).rows;
const SANDBOX = /sandbox|staging|stg|preprod|test|uat|--/i;
for (const a of agents) {
  const d = a.definition ?? {};
  console.log(`\n${a.slug}  [${a.status}]  activeEnvironment=${d.activeEnvironment ?? "(unset)"}`);
  console.log(`  allowedOrigins: ${(d.allowedOrigins ?? []).join(", ") || "(any)"}`);
  console.log(`  hostLoginUrl:   ${d.hostLoginUrl ?? "—"}`);
  for (const j of d.journeys ?? []) {
    const f = j.submission?.apiFlow;
    if (!f) continue;
    const bits = [f.saveTool && `save=${f.saveTool}`, f.confirmTool && `confirm=${f.confirmTool}`, f.paymentReturnUrl && `return=${f.paymentReturnUrl}`].filter(Boolean);
    if (bits.length) console.log(`  ${j.key}: ${bits.join("  ")}`);
  }
  for (const i of intgs.filter((x) => x.agent_id === a.id)) {
    for (const [env, spec] of Object.entries(i.environments ?? {})) {
      const live = env === (d.activeEnvironment ?? "production");
      const url = spec?.baseUrl ?? "—";
      console.log(`  ${live ? "USED " : "     "} ${i.name} · ${env}: ${url}${SANDBOX.test(String(url)) && live ? "   <-- SANDBOX HOST, IN USE" : ""}`);
    }
  }
}
await c.end();
