import { databaseUrlFrom } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";
async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(process.argv[2]!) });
  const db = drizzle(pool, { schema: { agents } });
  const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
  const def: any = row!.definition;
  for (const j of def.journeys ?? []) {
    writeFileSync(`${process.argv[3]}/guidance-${j.key}.txt`, String(j.guidance ?? ""));
  }
  await pool.end();
  process.exit(0);
}
main();
