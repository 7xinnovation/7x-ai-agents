"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Plus, Database, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea, Select, Badge } from "@/components/ui/field";

interface KbDoc { id: string; title: string; source: string; locale: "en" | "ar"; status: "draft" | "published" | "archived"; chunks: number; createdAt: string }

// File types the importer accepts (FB-1508). Word documents are not readable
// directly — the API returns a message asking for a PDF export instead.
const IMPORT_ACCEPT = ".pdf,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp";

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
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/agents/${slug}/kb`);
    if (res.ok) { const j = await res.json(); setDocs(j.docs); setEmbeddings(j.embeddings); }
    setLoading(false);
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!title.trim() || !content.trim()) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const res = await fetch(`/api/admin/agents/${slug}/kb`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, source, locale, content }) });
      const j = await res.json();
      if (res.ok) { setMsg(`Added "${title}" — ${j.chunks} chunk(s)${j.embedded ? ", embedded" : " (full-text)"}.`); setTitle(""); setSource(""); setContent(""); await load(); }
      else setMsg("Could not add document.");
    } finally { setBusy(false); }
  };

  /**
   * Import a document file (FB-1508): the server transcribes it to text, then it
   * is chunked, embedded and published exactly like pasted content. Title/source
   * default to the file name unless the admin filled them in.
   */
  const importFile = async (file: File) => {
    setImporting(true); setMsg(null); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("locale", locale);
      if (title.trim()) fd.append("title", title.trim());
      if (source.trim()) fd.append("source", source.trim());
      const res = await fetch(`/api/admin/agents/${slug}/kb`, { method: "POST", body: fd });
      const j = await res.json();
      if (res.ok) {
        setMsg(`Imported "${j.title}" — ${j.chunks} chunk(s) from ${j.characters.toLocaleString()} characters${j.embedded ? ", embedded" : " (full-text)"}.`);
        setTitle(""); setSource(""); setContent("");
        await load();
      } else {
        setErr(typeof j.error === "string" ? j.error : "Could not import that file.");
      }
    } catch {
      setErr("Could not import that file.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const remove = async (id: string) => { await fetch(`/api/admin/agents/${slug}/kb?id=${id}`, { method: "DELETE" }); await load(); };
  const toggle = async (d: KbDoc) => { await fetch(`/api/admin/agents/${slug}/kb`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id, status: d.status === "published" ? "draft" : "published" }) }); await load(); };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Add knowledge</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <p className="-mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">{embeddings ? <><Sparkles className="h-3.5 w-3.5 text-[var(--color-brand)]" /> Vector embeddings active — new content is embedded for semantic search.</> : "Indexed for full-text grounding. Set VOYAGE_API_KEY to enable vector search."}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Renewal process" /></Field>
            <Field label="Source label"><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Guide §3" /></Field>
          </div>
          <Field label="Language"><Select value={locale} onChange={(e) => setLocale(e.target.value as "en" | "ar")}><option value="en">English</option><option value="ar">Arabic</option></Select></Field>
          <Field label="Content" hint="Separate sections with blank lines; each becomes a chunk."><Textarea rows={7} dir={locale === "ar" ? "rtl" : "ltr"} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste the authoritative text…" /></Field>
          {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700">{msg}</div>}
          {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">{err}</div>}
          <Button onClick={add} disabled={busy || importing || !title.trim() || !content.trim()}><Plus className="h-4 w-4" /> {busy ? "Adding…" : "Add document"}</Button>

          {/* Import a file instead of pasting (FB-1508). PDFs and scans are
              transcribed server-side, then chunked and embedded identically. */}
          <div className="flex items-center gap-3 pt-1">
            <span className="h-px flex-1 bg-[var(--color-line)]" />
            <span className="text-[12px] font-medium uppercase tracking-wide text-muted">or import a file</span>
            <span className="h-px flex-1 bg-[var(--color-line)]" />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={IMPORT_ACCEPT}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy || importing}>
            <Upload className="h-4 w-4" /> {importing ? "Reading document…" : "Import document"}
          </Button>
          <p className="-mt-2 text-[12.5px] text-muted">
            PDF, text, markdown or an image of a page (up to 20MB). Scanned and Arabic pages are read too.
            Export Word files to PDF first. Title and source default to the file name.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Documents</CardTitle><span className="text-[13px] text-muted">{docs.length}</span></CardHeader>
        <CardContent>
          {loading ? <p className="py-2 text-sm text-muted">Loading…</p> : docs.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-9 text-center text-muted"><Database className="h-7 w-7" /><p className="max-w-[34ch] text-[13.5px]">No knowledge yet. Add documents so the agent answers with grounded, cited responses.</p></div>
          ) : docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 border-t border-[var(--color-line)] py-3 first:border-t-0">
              <span className="shrink-0 rounded-md border border-[var(--color-ring)] bg-[color-mix(in_srgb,var(--color-brand)_8%,white)] px-1.5 py-1 text-[11px] font-bold text-[var(--color-brand)]">{d.locale.toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{d.title}</span><span className="block truncate text-[12.5px] text-muted">{d.source} · {d.chunks} chunk{d.chunks === 1 ? "" : "s"}</span></span>
              <button onClick={() => toggle(d)} title="Toggle published / draft"><Badge tone={d.status === "published" ? "live" : "draft"} className="cursor-pointer">{d.status}</Badge></button>
              <button onClick={() => remove(d.id)} aria-label="Delete" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--color-line)] text-muted transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
