/**
 * "The system should not ask who is renewing if logged in using UAE PASS."
 *
 * The deterministic half of this is in the code: the tool result now carries an
 * instruction not to ask, because the case knows the box and the signed-in
 * profile knows the boxes. This is the half that stops the question being asked
 * BEFORE the tool is ever called — a model that decides to ask on its own gets
 * no tool result to be told off by.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-renewer-and-voice-2026-09-13.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");
if (!ENV) throw new Error("--env <envfile> is required");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const RULE =
  "DO NOT ASK A SIGNED-IN CUSTOMER WHO IS RENEWING (2026-09-13): \"Who is renewing this box?\" is a real question for a guest renewing on somebody else's behalf. For a customer signed in with UAE PASS, renewing a box that is on their own account, it is five descriptions of a person we are already looking at — and one of the five is the answer. Emirates Post reported it on 8 September and again on 13 September. " +
  "So: never put that question to the customer on your own initiative. Call the renewed-by options tool and read what comes back — when the box belongs to the signed-in customer the result says so explicitly and tells you to record 'The owner' and move on. Ask ONLY when the tool result does not say that: a guest, an unrecognised box, or a customer who has already told you they are renewing for someone else. And if they volunteer it — \"I'm renewing for my father\" — take their word for it over anything inferred, and never ask them to confirm it a second time. ";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  const changes: string[] = [];
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "nxn-dialog"));
    if (!row) throw new Error("nxn-dialog not found in this database");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    for (const j of def.journeys ?? []) {
      if (!/renewal|manage/.test(String(j.key))) continue;
      const g = String(j.guidance ?? "");
      if (g.includes(RULE.trim())) continue;
      j.guidance = `${g.trimEnd()}\n\n${RULE.trim()}`;
      changes.push(String(j.key));
    }
    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} journey(s): ${changes.join(", ")}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("written.");
    } else console.log("Dry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
