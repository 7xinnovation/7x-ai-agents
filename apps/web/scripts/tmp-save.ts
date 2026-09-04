import { config } from "dotenv";
config({ path: process.argv[process.argv.indexOf("--env") + 1] });
import { getDb } from "@dialog/db";
import { sql } from "drizzle-orm";
async function main() {
  const r: any = await getDb().execute(sql`
    select created_at, action, payload::text as p from audit_log
    where created_at > now() - interval '30 minutes'
      and (payload::text ilike '%Rental%' or action ilike '%fail%')
    order by created_at desc limit 2`);
  for (const x of r.rows ?? r) {
    if (x.action !== 'integration_call_failed') continue;
    const j = JSON.parse(x.p);
    console.log("PATH:", j.path);
    console.log("ERROR/RESPONSE:", JSON.stringify(j.response ?? j.error ?? j).slice(0, 900));
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
