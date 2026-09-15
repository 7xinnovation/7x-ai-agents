"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Trash2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

interface Row {
  id: string;
  companyName: string | null;
  tradeLicenseNumber: string | null;
  postalLicenseNumber: string | null;
  reason: string | null;
}
interface Batch {
  fileName: string;
  rowCount: number;
  skippedCount: number;
  uploadedBy: string | null;
  createdAt: string;
}

/**
 * Licensing's list of companies that may not renew.
 *
 * Their renewal process map checks it immediately after the company lookup and
 * stops the journey when it hits. The list is theirs and it changes, so it is
 * uploaded here rather than deployed.
 *
 * Uploading REPLACES the list. That is stated on the screen because the
 * alternative reading — that uploads accumulate — would leave a company
 * Licensing had removed blocked indefinitely, and nobody would find out until
 * an applicant complained.
 */
export function BlocklistManager({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/agents/${slug}/blocklist`);
      const j = await res.json();
      setRows(j.rows ?? []);
      setBatch(j.batch ?? null);
    } finally {
      setLoading(false);
    }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File) => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/agents/${slug}/blocklist`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) { setErr(typeof j.error === "string" ? j.error : "That file could not be read."); return; }
      const cols = Object.entries(j.columns ?? {})
        .filter(([, v]) => v)
        .map(([k, v]) => `${k} → "${v}"`)
        .join(", ");
      setMsg(
        `${j.rowCount.toLocaleString()} companies loaded from "${j.fileName}"` +
          (j.skippedCount ? `, ${j.skippedCount} empty row(s) ignored` : "") +
          (cols ? `. Columns read: ${cols}.` : ".")
      );
      await load();
    } catch {
      setErr("That file could not be uploaded.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clear = async () => {
    if (!confirm("Remove the whole list? No company will be blocked from renewing until a new list is uploaded.")) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      await fetch(`/api/admin/agents/${slug}/blocklist`, { method: "DELETE" });
      setMsg("List removed. No company is blocked.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader><CardTitle>Blocked companies</CardTitle></CardHeader>
        <CardContent className="grid gap-4 pt-1">
          <p className="text-[13px] leading-relaxed text-muted">
            Companies on this list cannot start a renewal. The assistant tells them the renewal can&apos;t proceed and
            that the Licensing team will contact them — it never says why, and never says they are on a list.
            Matched on trade licence number, postal licence number, or company name.
          </p>
          <p className="text-[13px] leading-relaxed text-muted">
            Upload a <strong>.csv</strong> or <strong>.xlsx</strong> with a column headed something like{" "}
            <em>Trade License Number</em>, <em>Postal License Number</em> or <em>Company Name</em>. An optional{" "}
            <em>Reason</em> column is kept for the team and never shown to a customer.{" "}
            <strong>Uploading replaces the whole list</strong>, so send the complete current list each time.
          </p>

          {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-700">{msg}</div>}
          {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err}</div>}

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={15} /> {busy ? "Reading…" : batch ? "Replace the list" : "Upload the list"}
            </Button>
            {batch && (
              <Button variant="ghost" onClick={() => void clear()} disabled={busy}>
                <Trash2 size={15} /> Remove the list
              </Button>
            )}
          </div>

          {loading ? (
            <p className="text-[13px] text-muted">Loading…</p>
          ) : batch ? (
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-[13px]">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <ShieldAlert size={15} /> {batch.rowCount.toLocaleString()} companies blocked
              </div>
              <p className="mt-1 text-muted">
                From <strong>{batch.fileName}</strong>
                {batch.uploadedBy ? `, uploaded by ${batch.uploadedBy}` : ""} on{" "}
                {new Date(batch.createdAt).toLocaleString()}
                {batch.skippedCount ? ` · ${batch.skippedCount} empty row(s) ignored` : ""}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-[13px] text-muted">
              No list uploaded. <strong>No company is blocked</strong> — every renewal proceeds.
            </div>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              First {rows.length} of {batch?.rowCount.toLocaleString() ?? rows.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-1">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-line)] text-left text-muted">
                    <th className="py-2 pr-4 font-medium">Company</th>
                    <th className="py-2 pr-4 font-medium">Trade licence</th>
                    <th className="py-2 pr-4 font-medium">Postal licence</th>
                    <th className="py-2 font-medium">Reason (internal)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0">
                      <td className="py-2 pr-4 text-ink">{r.companyName || <span className="text-muted">—</span>}</td>
                      <td className="py-2 pr-4 font-mono text-[12px]">{r.tradeLicenseNumber || <span className="text-muted">—</span>}</td>
                      <td className="py-2 pr-4 font-mono text-[12px]">{r.postalLicenseNumber || <span className="text-muted">—</span>}</td>
                      <td className="py-2 text-muted">{r.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
