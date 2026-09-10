import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(
  `select conversation_id, payload::text p, created_at from audit_log
    where action='case_submitted' and created_at > now() - interval '6 hours'
    order by created_at desc limit 12`);
for (const r of rows) console.log(r.created_at.toISOString(), r.conversation_id, r.p);
await c.end();
