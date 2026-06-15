/**
 * Embeddings via Voyage AI (Anthropic's recommended embeddings provider).
 * Guarded by VOYAGE_API_KEY: when unset, returns null and the platform falls
 * back to Postgres full-text search. voyage-3 outputs 1024-dim vectors, matching
 * the pgvector column in @dialog/db.
 */
export const EMBEDDING_DIM = 1024;

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

export async function embedTexts(
  texts: string[],
  inputType: "document" | "query" = "document"
): Promise<number[][] | null> {
  if (!process.env.VOYAGE_API_KEY || texts.length === 0) return null;
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.VOYAGE_MODEL ?? "voyage-3",
      input: texts,
      input_type: inputType,
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

/** Embed a single query string (input_type=query for retrieval). */
export async function embedQuery(text: string): Promise<number[] | null> {
  const out = await embedTexts([text], "query");
  return out?.[0] ?? null;
}
