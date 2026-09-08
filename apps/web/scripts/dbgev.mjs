import { readFileSync } from "node:fs";
import pg from "pg";
const c = new pg.Client({ connectionString: /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(process.argv[2], "utf8"))[1] });
await c.connect();
const r = await c.query(`SELECT type, count(*)::int n, max(created_at) last FROM analytics_events
  WHERE created_at > now() - interval '30 days' GROUP BY type ORDER BY n DESC`);
console.log("analytics_events, last 30 days:");
for (const x of r.rows) console.log(`  ${String(x.n).padStart(4)}  ${x.type.padEnd(26)} last ${x.last.toISOString().slice(0,16)}`);
const p = await c.query(`SELECT status, count(*)::int n, sum(amount)::numeric total FROM payments GROUP BY status`);
console.log("\npayments table:", p.rows.map(x=>`${x.status}=${x.n} (AED ${x.total})`).join(", ") || "(empty)");
const cs = await c.query(`SELECT count(*)::int n FROM audit_log WHERE action='case_submitted'`);
console.log("case_submitted audit rows:", cs.rows[0].n);
await c.end();
