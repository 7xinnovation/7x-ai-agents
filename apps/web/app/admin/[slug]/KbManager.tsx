"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash, Plus, Database, Sparkle } from "@phosphor-icons/react";

interface KbDoc {
  id: string;
  title: string;
  source: string;
  locale: "en" | "ar";
  chunks: number;
  createdAt: string;
}

export function KbManager({ slug }: { slug: string }) {
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [embeddings, setEmbeddings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [locale, setLocale] = useState<"en" | "ar">("en");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/agents/${slug}/kb`);
    if (res.ok) {
      const j = await res.json();
      setDocs(j.docs);
      setEmbeddings(j.embeddings);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${slug}/kb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, source, locale, content }),
      });
      const j = await res.json();
      if (res.ok) {
        setMsg(`Added "${title}" — ${j.chunks} chunk(s)${j.embedded ? ", embedded" : " (full-text)"}.`);
        setTitle("");
        setSource("");
        setContent("");
        await load();
      } else {
        setMsg("Could not add document.");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/admin/agents/${slug}/kb?id=${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="sa-cols">
      <div className="sa-panel sa-form">
        <div className="sa-panel-head">
          <h2>Add knowledge</h2>
        </div>
        <p className="sa-help">
          {embeddings ? (
            <>
              <Sparkle size={13} weight="fill" /> Vector embeddings active — new content is embedded for semantic search.
            </>
          ) : (
            "Stored and indexed for full-text grounding. Set VOYAGE_API_KEY to enable vector search."
          )}
        </p>
        <div className="sa-2col">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Renewal process" />
          </label>
          <label>
            Source label
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Licensing Guide §3" />
          </label>
        </div>
        <label>
          Language
          <select value={locale} onChange={(e) => setLocale(e.target.value as "en" | "ar")}>
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
        </label>
        <label>
          Content
          <textarea
            rows={8}
            dir={locale === "ar" ? "rtl" : "ltr"}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste the authoritative text. Separate sections with blank lines; each becomes a chunk."
          />
        </label>
        {msg ? <div className="sa-msg ok">{msg}</div> : null}
        <button className="sa-btn primary" onClick={add} disabled={busy || !title.trim() || !content.trim()}>
          <Plus size={16} /> {busy ? "Adding…" : "Add document"}
        </button>
      </div>

      <div className="sa-panel">
        <div className="sa-panel-head">
          <h2>Documents</h2>
          <span className="sa-muted">{docs.length}</span>
        </div>
        {loading ? (
          <p className="sa-empty-line">Loading…</p>
        ) : docs.length === 0 ? (
          <div className="sa-kb-empty">
            <Database size={26} />
            <p>No knowledge yet. Add documents so the agent can answer with grounded, cited responses.</p>
          </div>
        ) : (
          <div className="sa-list">
            {docs.map((d) => (
              <div className="sa-kb-row" key={d.id}>
                <span className="sa-kb-locale">{d.locale.toUpperCase()}</span>
                <span className="sa-listrow-main">
                  <span className="sa-listrow-name">{d.title}</span>
                  <span className="sa-listrow-sub">
                    {d.source} · {d.chunks} chunk{d.chunks === 1 ? "" : "s"}
                  </span>
                </span>
                <button className="sa-iconbtn" onClick={() => remove(d.id)} aria-label="Delete">
                  <Trash size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
