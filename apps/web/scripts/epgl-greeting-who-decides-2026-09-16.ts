/**
 * Who issues the licence, said in the first thing the customer reads.
 *
 * The transparency artefact requires it — القرار التنظيمي النهائي يصدر من الجهة
 * أو الموظف المخول وليس من Dialog — and it has been in the EPGL journey guidance
 * and persona since 15 September, which is where the assistant reads it and not
 * where the customer does.
 *
 * Mohammed Ali, 16 September (FB-1738): "We can add that consent at the greeting
 * section". So it goes in the greeting, above the service buttons, in both
 * languages: the sentence that stops an applicant reading "your application has
 * been approved" as the assistant having approved it.
 *
 * Idempotent. Run from apps/web, against an env file or an inherited
 * DATABASE_URL:
 *   npx tsx scripts/epgl-greeting-who-decides-2026-09-16.ts [--env <file>] [--apply]
 */
import { databaseUrlFromArgs } from "./lib/envFile";

const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";

/** The marker is the sentence itself: it can only be added once. */
const LINE = {
  en: "The final licensing decision is issued by Emirates Post Group Licensing — by the authorised officer, never by me.",
  ar: "القرار التنظيمي النهائي يصدر من الجهة أو الموظف المخول وليس من المساعد.",
};

/** Above the service buttons, under the introduction. */
function withClause(greeting: string, line: string): string {
  if (!greeting.trim() || greeting.includes(line)) return greeting;
  const fence = greeting.indexOf("```");
  if (fence === -1) return `${greeting.trimEnd()}\n\n${line}`;
  const head = greeting.slice(0, fence).trimEnd();
  return `${head}\n\n${line}\n\n${greeting.slice(fence)}`;
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFromArgs() });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];
    const greeting = { ...(def.greeting ?? {}) } as Record<string, string>;
    for (const loc of ["en", "ar"] as const) {
      const before = String(greeting[loc] ?? "");
      if (!before.trim()) continue;
      const after = withClause(before, LINE[loc]);
      if (after !== before) {
        greeting[loc] = after;
        changes.push(`greeting.${loc}: + who decides`);
      }
    }
    def.greeting = greeting;

    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    for (const c of changes) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else console.log("\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
