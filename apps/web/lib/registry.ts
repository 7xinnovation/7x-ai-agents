import { registerMockAdapters, registerAdapter } from "@dialog/core";
import type { KBAdapter, KBResult } from "@dialog/core";
import { getDb, kbChunks } from "@dialog/db";
import { and, eq, sql } from "drizzle-orm";

let initialised = false;

/**
 * Register all adapter providers once per server process. Mock providers cover
 * crm/auth/storage for now; knowledge is backed by Neon so grounding is real.
 * Real providers (salesforce, uaepass, s3) slot in here without touching agents.
 */
export function ensureAdapters() {
  if (initialised) return;
  registerMockAdapters();

  // Neon-backed KB: keyword retrieval over kb_chunks (pgvector-ready). Until an
  // embeddings provider is wired, rank by term-overlap via full-text matching.
  const neonKb: KBAdapter = {
    async search(_ctx, input): Promise<KBResult[]> {
      const db = getDb();
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
        .where(and(eq(kbChunks.agentId, input.agentId), sql`${tsv} @@ ${tsq}`))
        .orderBy(sql`ts_rank(${tsv}, ${tsq}) DESC`)
        .limit(input.limit ?? 4);
      return rows.map((r) => ({ content: r.content, source: r.source, score: Number(r.score) }));
    },
  };
  registerAdapter("knowledge", "neon", () => neonKb);

  initialised = true;
}
