import { config } from "dotenv";
config({ path: process.argv[process.argv.indexOf("--env") + 1] });
import { getDb } from "@dialog/db";
import { sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";
async function main() {
  const out: string[] = [];
  const r: any = await getDb().execute(sql`
    select created_at, payload::text as p from audit_log
    where action='integration_write' and payload::text like '%submitLicenseRequest%'
    order by created_at desc limit 1`);
  const j = JSON.parse((r.rows ?? r)[0].p);
  // Strip base64 if any and pretty-print
  out.push("### composite request\n```json\n" + JSON.stringify(j.input.body, null, 2) + "\n```\n");
  out.push("### composite response\n```\n" + String(j.response).slice(0, 6000) + "\n```\n");

  const n: any = await getDb().execute(sql`
    select created_at, action, payload::text as p from audit_log
    where action like 'epgl_payment%' order by created_at desc limit 3`);
  out.push("### payment notification audit\n```\n" + (n.rows ?? n).map((x: any) => `${x.created_at} ${x.action} ${x.p}`).join("\n") + "\n```\n");
  writeFileSync(process.argv[process.argv.indexOf("--out") + 1], out.join("\n"));
  console.log("written", out.join("").length, "chars");
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
