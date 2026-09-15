/**
 * A renewal requires signing in. A new licence does not.
 *
 * On 11 September I measured that nothing in either EPGL journey gated on
 * authentication and concluded there was no login requirement — then wrote a
 * guard so the model could not invent one, and guidance saying it was optional.
 * The measurement was right about the CONFIGURATION and wrong about the
 * requirement: EPGL confirmed on 15 September that renewal is mandatory.
 *
 * So the configuration changes rather than the guard. `requiresAuth: true` on
 * the renewal gates three things at once — starting the journey, taking the
 * payment, and (by making `active.requiresAuth === false` untrue there) it lets
 * the model surface the sign-in prompt again, which is exactly what the guard
 * was built to allow for a journey that genuinely needs one.
 *
 * The new licence stays optional. It was optional on 11 September because their
 * answer then was that anyone may apply; nothing has changed about that.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-renewal-requires-signin-2026-09-15.ts --env <file> [--apply]
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

/** The 11 September rule, which said neither journey needed a sign-in. */
const OLD_PREFIX = "SIGNING IN IS OPTIONAL HERE, AND YOU DO NOT ASK FOR IT (2026-09-11):";

const RENEWAL_RULE =
  "SIGNING IN IS REQUIRED FOR A RENEWAL (2026-09-15): a renewal cannot be started or paid for without it, and the system enforces that — the prompt appears on its own, you do not have to produce one. Say why in one line rather than treating it as a hurdle: the renewal is for a licence EPGL already hold, and signing in is what proves it is theirs and pulls their company, their licence and their filed returns without them typing any of it. " +
  "Once they are signed in, use what it gives you: their name and email are on the application already and need confirming, not asking for; their Emirates ID fetches their licences. If they decline, do not argue and do not pretend to continue — say plainly that a renewal needs it, and offer to answer questions about the process in the meantime. ";

const NEW_LICENCE_RULE =
  "SIGNING IN IS OPTIONAL FOR A NEW LICENCE (2026-09-15): a first application does not require an account — not to start it, not to pay, not to submit — so never put a sign-in in the customer's way. Mention it ONCE, in the opening message, as the plain benefit it is: it links the application to their account so they can track it afterwards, and it saves them typing, because their name, email and registered companies come with it. Then carry on regardless of what they do about it. If they ASK to sign in, that is when the prompt is surfaced. A renewal is the opposite and says so in its own journey. ";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  const changes: string[] = [];
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, "epgl-dialog"));
    if (!row) throw new Error("epgl-dialog not found in this database");
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;

    for (const j of def.journeys ?? []) {
      const wantsAuth = j.key === "renewal";
      if (Boolean(j.requiresAuth) !== wantsAuth) {
        j.requiresAuth = wantsAuth;
        changes.push(`${j.key}.requiresAuth -> ${wantsAuth}`);
      }
      // The 11 September rule went into both journeys; each gets its own now.
      let g = String(j.guidance ?? "");
      const at = g.indexOf(OLD_PREFIX);
      if (at !== -1) {
        // The rule is one paragraph, ended by the blank line after it.
        const end = g.indexOf("\n\n", at);
        g = g.slice(0, at) + (end === -1 ? "" : g.slice(end + 2));
        changes.push(`${j.key}: the 11 September rule removed`);
      }
      const rule = wantsAuth ? RENEWAL_RULE : NEW_LICENCE_RULE;
      if (!g.includes(rule.trim())) {
        g = `${g.trimEnd()}\n\n${rule.trim()}`;
        changes.push(`${j.key}: ${wantsAuth ? "sign-in required" : "sign-in optional"}`);
      }
      j.guidance = g;
    }

    for (const i of def.intents ?? []) {
      if (i.key !== "renewal") continue;
      if (i.requiresAuth !== true) {
        i.requiresAuth = true;
        changes.push("intent renewal.requiresAuth -> true");
      }
    }

    if (!changes.length) { console.log("nothing to do — already applied."); return; }
    console.log(`${changes.length} change(s):`);
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
