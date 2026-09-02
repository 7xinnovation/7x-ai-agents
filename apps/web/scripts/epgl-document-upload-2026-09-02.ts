/**
 * Attaching files is the server's job (2026-09-02).
 *
 * The guidance told the model to call epglsalesforce__uploadDocument itself. It
 * cannot: the call takes the file's BYTES, and the model has only ever seen a
 * name and a key. It tried twice on 2 Sep — once with an invented
 * `documents: [...]` array, once with a bare key and filename — and Salesforce
 * answered 400 both times. Meanwhile the real uploads, which run server-side
 * from the stored file after the submission lands, returned 201 and linked
 * correctly to the licence request.
 *
 * The tool is no longer offered to the model, so the guidance should stop
 * naming it.
 *
 * Idempotent. Run from apps/web:
 *   npx tsx scripts/epgl-document-upload-2026-09-02.ts [--env <file>]
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const envArg = process.argv.indexOf("--env");
config({
  path:
    envArg !== -1 && process.argv[envArg + 1]
      ? resolve(process.argv[envArg + 1]!)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

import { getDb, agents } from "@dialog/db";
import { eq } from "drizzle-orm";

const SLUG = "epgl-dialog";
const OLD = "and upload files with epglsalesforce__uploadDocument (base64) linked to that id.";
const NEW =
  "Do NOT attach the documents yourself — there is no tool for it and you do not have the files. Every document the customer uploaded is pushed to Salesforce automatically once the submission succeeds, linked to the licence request. Tell the customer their documents have been sent with the application; never say you are uploading them, and never claim one failed.";
const MARKER = "Do NOT attach the documents yourself";

interface Journey { key: string; submission?: { apiFlow?: { notes?: string } }; [k: string]: unknown }

async function main() {
  const db = getDb();
  const [row] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1);
  if (!row) throw new Error(`${SLUG} not found`);
  const def = row.definition as unknown as { journeys: Journey[] };
  let changed = 0;

  for (const j of def.journeys) {
    const f = j.submission?.apiFlow;
    if (!f) continue;
    const notes = String(f.notes ?? "");
    if (notes.includes(MARKER)) { console.log(`  (skip) ${j.key}`); continue; }
    if (notes.includes(OLD)) {
      f.notes = notes.split(OLD).join(NEW);
      console.log(`  + ${j.key}: replaced the upload instruction`);
    } else {
      f.notes = notes + " " + NEW;
      console.log(`  + ${j.key}: appended the upload note`);
    }
    changed++;
  }

  if (!changed) { console.log("nothing to do"); return; }
  await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  console.log(`\n${changed} journey(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
