"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!res.ok) { setError("Incorrect password."); return; }
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get("next") || "/admin";
    } catch { setError("Something went wrong."); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 [background-image:radial-gradient(110%_70%_at_50%_-10%,rgba(0,32,245,.08),transparent_55%)]">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[var(--color-line)] bg-surface p-7 shadow-[0_1px_2px_rgba(16,24,40,.05),0_30px_60px_-20px_rgba(16,24,40,.3)]">
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-[#0020f5] shadow-[0_10px_24px_-6px_rgba(0,32,245,.5)]"><img src="/7xlogo.svg" alt="7X" className="h-5 w-auto" /></span>
        <h1 className="text-[21px] font-extrabold tracking-tight">Admin sign in</h1>
        <p className="mb-5 mt-1 text-sm text-muted">Enter the admin password to manage agents.</p>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus placeholder="••••••••" /></Field>
        {error && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">{error}</div>}
        <Button type="submit" disabled={busy || !password} className="mt-4 h-11 w-full">{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </div>
  );
}
