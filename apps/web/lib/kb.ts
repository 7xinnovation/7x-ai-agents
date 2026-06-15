import { getDb, kbDocuments, kbChunks } from "@dialog/db";
import { embedTexts } from "@dialog/core";
import { and, eq, sql, desc } from "drizzle-orm";

/** Split content into retrieval-sized chunks (paragraphs, with a length cap). */
export function chunkContent(content: string): string[] {
  const paras = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of paras.length ? paras : [content.trim()]) {
    if (p.length <= 1200) {
      out.push(p);
      continue;
    }
    // Hard-split very long paragraphs on sentence boundaries.
    let buf = "";
    for (const s of p.split(/(?<=[.!؟?])\s+/)) {
      if ((buf + " " + s).length > 1200) {
        if (buf) out.push(buf.trim());
        buf = s;
      } else {
        buf += " " + s;
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.filter(Boolean);
}

export async function createKbDocument(input: {
  agentId: string;
  title: string;
  source: string;
  locale: "en" | "ar";
  content: string;
}) {
  const db = getDb();
  const [doc] = await db
    .insert(kbDocuments)
    .values({
      agentId: input.agentId,
      title: input.title,
      source: input.source || input.title,
      version: "1",
      locale: input.locale,
    })
    .returning();

  const chunks = chunkContent(input.content);
  // Embed when a provider is configured; otherwise store null and rely on FTS.
  let vectors: number[][] | null = null;
  try {
    vectors = await embedTexts(chunks, "document");
  } catch {
    vectors = null;
  }

  if (chunks.length) {
    await db.insert(kbChunks).values(
      chunks.map((content, i) => ({
        agentId: input.agentId,
        documentId: doc!.id,
        content,
        embedding: vectors?.[i] ?? null,
        metadata: { source: input.source || input.title, title: input.title },
      }))
    );
  }
  return { id: doc!.id, chunks: chunks.length, embedded: Boolean(vectors) };
}

export async function listKbDocuments(agentId: string) {
  return getDb()
    .select({
      id: kbDocuments.id,
      title: kbDocuments.title,
      source: kbDocuments.source,
      locale: kbDocuments.locale,
      version: kbDocuments.version,
      createdAt: kbDocuments.createdAt,
      chunks: sql<number>`count(${kbChunks.id})::int`,
    })
    .from(kbDocuments)
    .leftJoin(kbChunks, eq(kbChunks.documentId, kbDocuments.id))
    .where(eq(kbDocuments.agentId, agentId))
    .groupBy(kbDocuments.id)
    .orderBy(desc(kbDocuments.createdAt));
}

export async function deleteKbDocument(agentId: string, docId: string) {
  await getDb()
    .delete(kbDocuments)
    .where(and(eq(kbDocuments.id, docId), eq(kbDocuments.agentId, agentId)));
}
