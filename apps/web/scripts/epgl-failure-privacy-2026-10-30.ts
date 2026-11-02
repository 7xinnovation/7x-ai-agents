/**
 * What a customer is told when a submission fails (30 October 2026).
 *
 * EPGL raised it as a privacy issue, and they are right. A 2.0 submission
 * failed, the customer asked "what is the technical issue", and the assistant
 * answered with Emirates Post's internals: a parameter their API wants, where
 * it comes from, what its values mean, and which of the two systems was at
 * fault — "a configuration issue between this assistant and EPGL's backend".
 *
 * The call log (09:52:24) shows what Salesforce actually said: an invalid value
 * for "UAE PASS Assurance Level", no Contact for the signatory's UAE PASS id,
 * and four lines of Apex stack trace. So the TERM the customer was given was
 * real. What was built on top of it was not — that assurance levels "are set
 * when you authenticate", that they come in "basic, enhanced, etc.", that the
 * value "wasn't available in this session", that the fault lay between two
 * systems. None of that is in the body. One line of a real error became a
 * paragraph of confident explanation, which is the harder version of this to
 * catch: most of it was true.
 *
 * The code half is in `lib/integrations.ts`: a failed call now reaches the model
 * with the body labelled as material for its decision rather than a passage to
 * paraphrase. This is the half that belongs in the journey — what to SAY — and
 * it goes on both journeys of both agents, because the failure mode is the
 * assistant's, not the service's.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-failure-privacy-2026-10-30.ts --env <file> [--slug nxn-dialog] [--apply]
 */
import { databaseUrlFrom } from "./lib/envFile";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const SLUG = arg("--slug") ?? "epgl-dialog";
const APPLY = process.argv.includes("--apply");

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { agents } from "@dialog/db";
import { eq } from "drizzle-orm";

export const MARKER = "WHEN SOMETHING FAILS, SAY WHAT IT MEANS, NOT HOW IT BROKE (2026-10-30";

export const RULE = `
${MARKER} — from EPGL). A customer who is told why a system failed has been handed something that is not theirs, and on 30 October they were handed something that was not even true. Both halves stop here.

WHAT YOU NEVER PUT IN FRONT OF THEM. The name of a field, a parameter, an object or a tool. An endpoint, a URL or a status code. A stack trace or an error identifier. The word API, integration, configuration, token, session, endpoint, backend or payload. Which side the fault is on — "a configuration issue between this assistant and EPGL's backend" tells an applicant that two companies are arguing over their licence.

AND NEVER EXPLAIN WHAT THE ERROR DID NOT EXPLAIN. Recognising a term is not permission to describe it. On the day this was reported the message named a real value, and the assistant went on to say where that value is set, what it measures, what its levels are called and whose fault the whole thing was — none of which the error said. It read as authoritative precisely because the first line was true. If you find yourself adding a sentence that begins "this is because" or "these are set when", you are writing from your own knowledge about somebody else's system, in front of the customer whose application just failed.

WHAT YOU DO SAY. If the failure says something about THEIR application that they could act on — a document that is out of date, a licence number that does not match, an application they have already filed — say that plainly, in their words, and tell them how to put it right. If it does not, three sentences: it could not be submitted, nothing they did is wrong and nothing needs doing again, and here is the reference and who picks it up. Then stop. "What is the technical issue?" is answered with "it is on our side and the team has it, under <reference>" — not with a description of the fault.

NOTHING IS LOST BY THIS. Every failure is written to the call log in full, with the request and the response, which is where it is actually diagnosed. The customer gets the reference; we keep the detail.
`.trim();

async function main() {
  // Read here, not at import: the test imports MARKER and RULE from this file
  // and has no database to name.
  const env = arg("--env");
  if (!env) throw new Error("--env <envfile> is required");
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(env) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];
    for (const j of def.journeys ?? []) {
      const g = String(j.guidance ?? "");
      if (g.includes(MARKER)) continue;
      j.guidance = `${g.trimEnd()}\n\n${RULE}`;
      changes.push(`${j.key}: +${RULE.length} chars of guidance`);
    }
    if (!changes.length) { console.log(`${SLUG}: nothing to do — already applied.`); return; }
    console.log(`${SLUG} — ${changes.length} change(s):`);
    for (const c of changes) console.log(`   ~ ${c}`);
    if (APPLY) {
      await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
      console.log("\nwritten.");
    } else console.log("\nDry run — nothing written. Add --apply to write.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("epgl-failure-privacy-2026-10-30.ts")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
