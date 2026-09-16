/**
 * The callback nobody can answer.
 *
 * 16 September: "why is there a speak to a staff member option on the Arabic?"
 * — التحدّث مع موظف, offered as a fourth chip on the opening message. It is not
 * an Arabic problem: the chips are written by the MODEL from the agent's intent
 * list, and `human_help` — "Request a callback from an EPGL agent" — is in that
 * list, so it surfaces in both languages and inconsistently in each. Probed
 * against staging the same day, the English opener offered "Request a callback".
 *
 * The reason to take it out is not the inconsistency. THE CALLBACK IS NOT
 * CONNECTED: nothing on the EPGL side receives one. An agent that offers a
 * customer a call back from a team that will never be told is worse than an
 * agent that offers nothing.
 *
 * Emre, 16 September: "remove it for now as the callback is not connected. we
 * will connect that once we receive from salesforce on EPGL the callback
 * request." So this removes the intent and nothing else — the escalation path in
 * the code is untouched and ready for the day their endpoint exists.
 *
 * Idempotent. Run from apps/web, against an env file or an inherited
 * DATABASE_URL:
 *   npx tsx scripts/epgl-drop-callback-2026-09-16.ts --env <file> [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ENV = arg("--env");
const APPLY = process.argv.includes("--apply");
const DB_URL = ENV ? undefined : process.env.DATABASE_URL;
if (!ENV && !DB_URL) throw new Error("--env <envfile>, or a DATABASE_URL in the environment, is required");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
/** The intent itself, and anything that would make the model re-offer it. */
const INTENT_KEYS = ["human_help"];
const CALLBACK = /callback|call you back|اتصال من موظف|معاودة الاتصال/i;

async function main() {
  const pool = new pg.Pool({ connectionString: ENV ? databaseUrlFrom(ENV) : DB_URL! });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];

    const before = (def.intents ?? []) as { key: string; description?: Record<string, string> }[];
    const after = before.filter((i) => !INTENT_KEYS.includes(i.key));
    if (after.length !== before.length) {
      for (const i of before.filter((x) => INTENT_KEYS.includes(x.key))) {
        changes.push(`intent removed: ${i.key} — "${i.description?.en ?? ""}"`);
      }
      def.intents = after;
    }

    // A greeting that offers it in its own ```buttons list would put the chip
    // back however the intents read. Neither language's greeting does today;
    // this reports it rather than rewriting a greeting nobody asked me to touch.
    for (const [loc, text] of Object.entries((def.greeting ?? {}) as Record<string, string>)) {
      if (CALLBACK.test(String(text))) console.log(`   ! greeting.${loc} still mentions a callback — check by hand`);
    }

    /**
     * The one place the guidance ASKS for a callback.
     *
     * Both journeys handle up to eight partners and then say: "More than 8
     * partners is beyond what this form handles: say so plainly and offer a
     * callback rather than proceeding with an incomplete set." Removing the
     * intent does not remove that sentence, and a customer with nine partners is
     * exactly the customer who would be left waiting for a call.
     *
     * The other two mentions are prohibitions — "never offer a callback for it"
     * — and are left exactly as they are.
     */
    const OFFER = "offer a callback rather than proceeding with an incomplete set";
    const INSTEAD = "tell them to complete this application directly with EPGL licensing rather than proceeding with an incomplete set";
    for (const j of def.journeys ?? []) {
      const g = typeof j.guidance === "string" ? j.guidance : String(j.guidance?.en ?? "");
      if (g.includes(OFFER)) {
        const next = g.split(OFFER).join(INSTEAD);
        if (typeof j.guidance === "string") j.guidance = next;
        else j.guidance = { ...j.guidance, en: next };
        changes.push(`${j.key}: the >8 partners fallback no longer offers a callback`);
      }
      const after = typeof j.guidance === "string" ? j.guidance : String(j.guidance?.en ?? "");
      // Anything left is a prohibition, which is the wording we want to keep.
      for (const line of after.split(/\n|(?<=\.)\s+(?=[A-Z])/)) {
        if (CALLBACK.test(line) && !/never offer a callback/i.test(line)) {
          console.log(`   ! journey ${j.key} still mentions a callback — check by hand: ${line.trim().slice(0, 120)}`);
        }
      }
    }

    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    console.log(`\nintents left: ${(def.intents ?? []).map((i: { key: string }) => i.key).join(", ")}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else console.log("\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
