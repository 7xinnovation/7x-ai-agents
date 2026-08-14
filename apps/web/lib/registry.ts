import { registerMockAdapters, registerAdapter, embeddingsEnabled, embedQuery, registerSalesforceAdapter, registerNgeniusAdapter, registerUaePassAdapter } from "@dialog/core";
import type { KBAdapter, KBResult, StorageAdapter } from "@dialog/core";
import { getDb, kbChunks, kbDocuments, documentBlobs } from "@dialog/db";
import { and, eq, sql, inArray } from "drizzle-orm";

let initialised = false;

/**
 * Register all adapter providers once per server process. Mock providers let the
 * platform run end-to-end; real providers are credential-activated and selected
 * per agent via integrations.<cap>.provider — binding to "salesforce" / "ngenius"
 * / "uaepass" switches that capability from mock to the real vendor with zero
 * code change. Knowledge is always backed by Neon (pgvector) so grounding is real.
 */
export function ensureAdapters() {
  if (initialised) return;
  registerMockAdapters();
  // Real vendor adapters (used only when an agent's integration binds to them).
  registerSalesforceAdapter();
  registerNgeniusAdapter();
  registerUaePassAdapter();

  // Neon-backed KB: keyword retrieval over kb_chunks (pgvector-ready). Until an
  // embeddings provider is wired, rank by term-overlap via full-text matching.
  const neonKb: KBAdapter = {
    async search(_ctx, input): Promise<KBResult[]> {
      const db = getDb();
      const limit = input.limit ?? 4;
      // Only retrieve chunks whose parent document is published (PRD lifecycle).
      const publishedDocs = db
        .select({ id: kbDocuments.id })
        .from(kbDocuments)
        .where(eq(kbDocuments.status, "published"));

      // Vector search when an embeddings provider is configured (pgvector cosine).
      if (embeddingsEnabled()) {
        try {
          const qvec = await embedQuery(input.query);
          if (qvec) {
            const lit = `[${qvec.join(",")}]`;
            const rows = await db
              .select({
                content: kbChunks.content,
                source: sql<string>`coalesce(${kbChunks.metadata} ->> 'source', 'knowledge-base')`,
                score: sql<number>`1 - (${kbChunks.embedding} <=> ${lit}::vector)`,
              })
              .from(kbChunks)
              .where(
                and(
                  eq(kbChunks.agentId, input.agentId),
                  sql`${kbChunks.embedding} is not null`,
                  inArray(kbChunks.documentId, publishedDocs)
                )
              )
              .orderBy(sql`${kbChunks.embedding} <=> ${lit}::vector`)
              .limit(limit);
            if (rows.length) return rows.map((r) => ({ content: r.content, source: r.source, score: Number(r.score) }));
          }
        } catch {
          // fall through to full-text on any embedding/query error
        }
      }

      // English gets stemming; Arabic falls back to 'simple' (no AR stemmer by default).
      const cfg = input.locale === "ar" ? "simple" : "english";
      // OR-match significant terms (>=3 chars), so a natural-language question
      // retrieves passages instead of requiring every word (plainto = AND).
      const terms = (input.query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 12);
      if (!terms.length) return [];
      const orQuery = terms.join(" | ");
      const tsv = sql`to_tsvector(${cfg}, ${kbChunks.content})`;
      const tsq = sql`to_tsquery(${cfg}, ${orQuery})`;
      const rows = await db
        .select({
          content: kbChunks.content,
          source: sql<string>`coalesce(${kbChunks.metadata} ->> 'source', 'knowledge-base')`,
          score: sql<number>`ts_rank(${tsv}, ${tsq})`,
        })
        .from(kbChunks)
        .where(and(eq(kbChunks.agentId, input.agentId), sql`${tsv} @@ ${tsq}`, inArray(kbChunks.documentId, publishedDocs)))
        .orderBy(sql`ts_rank(${tsv}, ${tsq}) DESC`)
        .limit(input.limit ?? 4);
      return rows.map((r) => ({ content: r.content, source: r.source, score: Number(r.score) }));
    },
  };
  registerAdapter("knowledge", "neon", () => neonKb);

  /**
   * Durable document storage in Postgres.
   *
   * The only storage provider registered before this was "mock", which keeps the
   * bytes in a 200-entry in-process Map. Uploads survived until the next restart,
   * eviction or scale event — and submission reads them back to attach to
   * Salesforce, so an application could be filed without the trade licence it was
   * approved on. There is an audit action for it (sf_document_skipped /
   * bytes_unavailable), which is the shape of a failure someone expected.
   *
   * put() upserts on storageKey so re-uploading the same document key replaces the
   * bytes rather than accumulating orphans; get() returns null for anything not
   * found, which the submission path already treats as "skip and audit" rather
   * than an error.
   */
  const pgStorage: StorageAdapter = {
    async put(_ctx, input) {
      const storageKey = `pg://${input.caseId}/${input.key}/${input.fileName}`;
      const bytes = Buffer.from(input.bytes);
      await getDb()
        .insert(documentBlobs)
        .values({
          storageKey,
          caseId: input.caseId,
          contentType: input.contentType || "application/octet-stream",
          sizeBytes: bytes.length,
          bytes,
        })
        .onConflictDoUpdate({
          target: documentBlobs.storageKey,
          set: { bytes, contentType: input.contentType || "application/octet-stream", sizeBytes: bytes.length },
        });
      return { storageKey };
    },
    async get(_ctx, input) {
      const [row] = await getDb()
        .select({ bytes: documentBlobs.bytes, contentType: documentBlobs.contentType })
        .from(documentBlobs)
        .where(eq(documentBlobs.storageKey, input.storageKey))
        .limit(1);
      if (!row) return null;
      return { bytes: new Uint8Array(row.bytes), contentType: row.contentType };
    },
  };
  registerAdapter("storage", "postgres", () => pgStorage);

  initialised = true;
}
