import { registerMockAdapters, registerAdapter, embeddingsEnabled, embedQuery, registerSalesforceAdapter, registerNgeniusAdapter, registerUaePassAdapter } from "@dialog/core";
import type { KBAdapter, KBResult } from "@dialog/core";
import { getDb, kbChunks, kbDocuments } from "@dialog/db";
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

  initialised = true;
}
