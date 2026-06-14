"use client";

import { useState } from "react";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Incorrect password.");
        return;
      }
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get("next") || "/admin";
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin admin-login">
      <form className="admin-login-card" onSubmit={submit}>
        <h1>Admin sign in</h1>
        <p>Enter the admin password to manage agents.</p>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            placeholder="••••••••"
          />
        </label>
        {error ? <div className="admin-msg err">{error}</div> : null}
        <button className="admin-btn primary" type="submit" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
