import { databaseUrlFrom } from "./lib/envFile";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { cases, auditLog } from "@dialog/db";
import { eq, desc } from "drizzle-orm";
const pool = new pg.Pool({ connectionString: databaseUrlFrom(process.argv[2]!) });
const db = drizzle(pool, { schema: { cases, auditLog } });
const rows = await db.select().from(cases).orderBy(desc(cases.updatedAt)).limit(60);
const v = rows.find((c) => String((c.state as any).data?.payment_method ?? "") === "viban" && (c.state as any).status !== "submitted");
if (!v) { console.log("no such case"); } else {
  console.log(`conversation ${v.conversationId}`);
  const aud = await db.select().from(auditLog).where(eq(auditLog.conversationId, v.conversationId!)).orderBy(desc(auditLog.createdAt)).limit(40);
  for (const r of aud.reverse()) console.log(`${r.createdAt.toISOString().slice(11,19)} ${r.action}  ${JSON.stringify(r.payload).slice(0,150)}`);
}
await pool.end();
