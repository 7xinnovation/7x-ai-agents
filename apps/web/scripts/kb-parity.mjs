import { readFileSync } from "node:fs";
import pg from "pg";
const q = `SELECT a.slug, d.title, count(c.id)::int AS chunks,
  count(c.embedding)::int AS embedded
  FROM kb_documents d JOIN agents a ON a.id = d.agent_id
  LEFT JOIN kb_chunks c ON c.document_id = d.id
  GROUP BY a.slug, d.title ORDER BY a.slug, d.title`;
const load = async (f) => {
  const c = new pg.Client({ connectionString: /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(f, "utf8"))[1] });
  await c.connect(); const r = await c.query(q); await c.end();
  return new Map(r.rows.map((x) => [`${x.slug}::${x.title}`, x]));
};
const [a, b] = await Promise.all([load(process.argv[2]), load(process.argv[3])]);
let bad = 0;
for (const [k, s] of a) {
  const p = b.get(k);
  if (!p) { console.log(`MISSING on prod  ${k}`); bad++; continue; }
  if (p.chunks !== s.chunks || p.embedded !== s.embedded)
    { console.log(`DIFFERS ${k}: staging ${s.chunks} chunks/${s.embedded} embedded · prod ${p.chunks}/${p.embedded}`); bad++; }
  if (p.embedded === 0) { console.log(`NOT SEARCHABLE on prod (no embeddings) ${k}`); bad++; }
}
for (const k of b.keys()) if (!a.has(k)) console.log(`extra on prod   ${k}`);
console.log(bad ? `\n${bad} problem(s)` : `\nall ${a.size} document(s) match, chunk for chunk`);
