/**
 * The branch's name, in the language the customer is being answered in.
 *
 * Emirates Post reported on 10 September, from an Arabic conversation: the
 * customer pressed "NXN - Al Barsha Branch" and the reply began
 *
 *   سأجلب الأرقام المتاحة في فرع الرشيدية.
 *
 * — a real branch, and not theirs. Two faults met there, and this script is the
 * half that lives in the journey guidance.
 *
 * The branch step says to show "the returned offices as CARDS (nameEn,
 * workingTime)". In an Arabic conversation that produces English cards and
 * English buttons, to a customer who wrote back to say she is elderly and
 * cannot read English. And it leaves the model with no Arabic name to copy, so
 * when it writes an Arabic sentence about a branch it transliterates one:
 * «الرشيدية» for a branch whose nameAr is «مكتب بريد الراشدية». It wrote the
 * name two different ways in two consecutive turns of the same conversation.
 *
 * Emirates Post send both spellings on every row. The rule was always "use
 * THEIR name" — this makes it say which of their two names that is.
 *
 * The matching change in the tool-result note, and the guard that drops a
 * progress line naming the wrong branch, are in the code and deploy with it.
 * Only this sentence lives in the database, so only this needs a script.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/nxn-branch-name-locale-2026-09-10.ts --env <file> [--apply]
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

const SLUG = "nxn-dialog";

const OLD = "the returned offices as CARDS (nameEn, workingTime), remembering each office's officeId";
const NEW =
  "the returned offices as CARDS (the branch's own name AS EMIRATES POST WRITE IT — nameAr when you are answering in Arabic, nameEn when you are answering in English — and workingTime), remembering each office's officeId. " +
  "Never translate, transliterate or shorten a branch name yourself: every row carries both spellings, so there is always one to copy. " +
  "And name ONLY the branch the customer chose. A sentence announcing what you are about to fetch — \"I'll get the numbers at ...\", \"سأجلب الأرقام المتاحة في ...\" — must carry that branch and no other; naming a neighbouring branch there sends the customer to the wrong post office even when the list underneath is right";

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrlFrom(ENV!) });
  const db = drizzle(pool, { schema: { agents } });
  try {
    const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG));
    if (!row) throw new Error(`${SLUG} not found in this database`);
    const def = JSON.parse(JSON.stringify(row.definition)) as Record<string, any>;
    const changes: string[] = [];

    for (const j of def.journeys ?? []) {
      const before = String(j?.guidance ?? "");
      if (!before.includes(OLD)) continue;
      j.guidance = before.split(OLD).join(NEW);
      changes.push(String(j.key));
    }

    if (!changes.length) { console.log("nothing to do — already applied, or the branch step has moved."); return; }
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
