import { readFileSync } from "node:fs";
import pg from "pg";
const c = new pg.Client({ connectionString: /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(process.argv[2], "utf8"))[1] });
await c.connect();
const r = await c.query(`SELECT created_at, conversation_id, payload FROM audit_log
  WHERE action='turn_failed' AND created_at > now() - interval '40 minutes' ORDER BY created_at DESC LIMIT 6`);
for (const x of r.rows) console.log(`\n${x.created_at.toISOString()} conv=${x.conversation_id}\n${JSON.stringify(x.payload).slice(0, 900)}`);
await c.end();
