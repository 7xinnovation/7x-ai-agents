import { readFileSync } from "node:fs";
import pg from "pg";
const c = new pg.Client({ connectionString: /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(process.argv[2], "utf8"))[1] });
await c.connect();
const r = await c.query(`SELECT created_at, action, conversation_id, payload FROM audit_log
  WHERE created_at > now() - interval '25 minutes' AND action NOT LIKE 'integration_write' ORDER BY created_at DESC LIMIT 25`);
for (const x of r.rows) {
  const p = x.payload ?? {};
  console.log(`${x.created_at.toISOString()} ${x.action} ${p.path ?? ""} ${String(p.response ?? "").slice(0,120).replace(/\n/g," ")}`);
}
await c.end();
