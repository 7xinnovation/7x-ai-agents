/**
 * Give uploaded documents somewhere durable to live.
 *
 * Until now the only storage provider in the codebase was "mock": bytes went into
 * a 200-entry in-process Map and the `documents` row recorded a `mock://` key
 * pointing at them. Any restart, deploy, scale event or the 201st upload dropped
 * them. Staging has 156 document rows and not one retrievable file.
 *
 * That is worse than losing files. On submission the bytes are read back and
 * attached to the Salesforce record, so an application could be filed WITHOUT the
 * trade licence it was approved on — audited as sf_document_skipped, which tells
 * you someone foresaw this.
 *
 * This creates document_blobs and repoints every agent's storage capability at
 * the postgres provider, then proves a byte-for-byte round trip through the real
 * adapter before declaring success.
 *
 * Existing mock:// rows are left alone: there are no bytes anywhere to migrate,
 * and rewriting the keys would only disguise that. They stay visibly unreadable.
 *
 * Run from apps/web:
 *   npx tsx scripts/apply-document-storage.ts [--env <file>] [--dry-run]
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

import { getDb, agents, documentBlobs, cases } from "@dialog/db";
import { eq, sql } from "drizzle-orm";
import { ensureAdapters } from "../lib/registry";
import { resolveAdapters, adapterContext } from "@dialog/core";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getDb();

  console.log("1. document_blobs table");
  if (dryRun) {
    console.log("   (dry run) would create if absent");
  } else {
    // bytea + a unique storage_key; cascade with the case so deleting a case
    // takes its files with it rather than orphaning megabytes.
    await db.execute(sql`
      create table if not exists document_blobs (
        id uuid primary key default gen_random_uuid(),
        storage_key text not null unique,
        case_id uuid not null references cases(id) on delete cascade,
        content_type text not null,
        size_bytes integer not null,
        bytes bytea not null,
        created_at timestamptz not null default now()
      )
    `);
    await db.execute(sql`create index if not exists document_blobs_case_idx on document_blobs(case_id)`);
    console.log("   ok — table and index present");
  }

  console.log("\n2. point each agent's storage capability at postgres");
  const rows = await db.select().from(agents);
  for (const row of rows) {
    const def = row.definition as Record<string, any>;
    const cur = def.integrations?.storage?.provider;
    if (cur === "postgres") {
      console.log(`   (skip) ${def.slug}: already postgres`);
      continue;
    }
    console.log(`   ${dryRun ? "would set" : "   +    "} ${def.slug}: ${cur ?? "(unset)"} -> postgres`);
    if (dryRun) continue;
    def.integrations = def.integrations ?? {};
    def.integrations.storage = { ...(def.integrations.storage ?? {}), provider: "postgres", settings: def.integrations.storage?.settings ?? {}, secretRefs: def.integrations.storage?.secretRefs ?? [] };
    await db.update(agents).set({ definition: def as never }).where(eq(agents.id, row.id));
  }

  if (dryRun) {
    console.log("\n--dry-run, nothing written");
    return;
  }

  console.log("\n3. round-trip through the real adapter");
  // Needs a real case id: case_id is a foreign key, so a synthetic one would only
  // prove the insert is unconstrained.
  const [aCase] = await db.select({ id: cases.id }).from(cases).limit(1);
  if (!aCase) {
    console.log("   (skipped) no case rows in this database to attach a test blob to");
  } else {
    const [row] = rows;
    const def = row!.definition as Record<string, any>;
    ensureAdapters();
    const adapters = resolveAdapters(def as never);
    if (!adapters.storage?.get) throw new Error("storage adapter did not resolve with a get()");
    const ctx = adapterContext(def as never, def.integrations.storage);
    // Deliberately includes a NUL and high bytes — bytea round trips these fine,
    // a text column would not, and that is the kind of corruption you only find
    // when someone's PDF will not open.
    const payload = new Uint8Array([0, 1, 2, 250, 251, 255, 65, 66, 0, 67]);
    const put = await adapters.storage.put(ctx, {
      caseId: aCase.id,
      key: "__storage_selftest",
      fileName: "selftest.bin",
      bytes: payload,
      contentType: "application/octet-stream",
    });
    const got = await adapters.storage.get(ctx, { storageKey: put.storageKey });
    const same = got && Buffer.from(got.bytes).equals(Buffer.from(payload));
    console.log(`   ${same ? "ok" : "FAILED"} — ${payload.length} bytes written and read back identical`);
    await db.delete(documentBlobs).where(eq(documentBlobs.storageKey, put.storageKey));
    if (!same) process.exitCode = 1;
  }

  const stale = (await db.execute(sql`select count(*)::int as n from documents where storage_key like 'mock://%'`)).rows as { n: number }[];
  const n = stale[0]?.n ?? 0;
  if (n) {
    console.log(`\nNOTE: ${n} existing document rows still carry a mock:// key. Their bytes were never`);
    console.log("stored anywhere, so there is nothing to migrate — they stay unreadable, visibly so.");
    console.log("Anything uploaded from now on is durable.");
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
