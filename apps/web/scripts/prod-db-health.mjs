import { readFileSync } from "node:fs";
import pg from "pg";
const c = new pg.Client({ connectionString: /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(process.argv[2], "utf8"))[1] });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log(`\n${label}`); for (const row of r.rows) console.log("  ", JSON.stringify(row)); if (!r.rows.length) console.log("   (none)"); }
  catch (e) { console.log(`\n${label}\n   ERROR ${e.message}`); }
};
await q("tables and row counts", `SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY n_live_tup DESC`);
await q("conversations with no agent", `SELECT count(*)::int n FROM conversations WHERE agent_id IS NULL`);
await q("cases by status", `SELECT status, count(*)::int n FROM cases GROUP BY status ORDER BY n DESC`);
await q("payments left unsettled (state, count, oldest)", `SELECT state, count(*)::int n, min(created_at) oldest FROM payments GROUP BY state ORDER BY n DESC`);
await q("audit rows by action, last 7 days", `SELECT action, count(*)::int n FROM audit_log WHERE created_at > now() - interval '7 days' GROUP BY action ORDER BY n DESC LIMIT 15`);
await q("biggest tables on disk", `SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) size FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8`);
await q("kb chunks with no embedding", `SELECT count(*)::int n FROM kb_chunks WHERE embedding IS NULL`);
await q("users", `SELECT email, role, active, agent_scope, last_login_at FROM users ORDER BY created_at`);
await q("agents", `SELECT slug, status, definition->>'activeEnvironment' env, length(definition::text) def_bytes FROM agents ORDER BY slug`);
await c.end();
