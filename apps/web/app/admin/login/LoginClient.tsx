"use client";

import { useState } from "react";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export function LoginClient({ ssoEnabled }: { ssoEnabled: boolean }) {
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
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
        setError(res.status === 429 ? "Too many attempts. Wait a moment and try again." : "Incorrect password.");
        return;
      }
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get("next") || "/admin";
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel — composition element of the light theme, not a theme flip. */}
      <aside className="relative hidden overflow-hidden bg-[#06070c] lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* Electric-blue field glow + fine dot grid, both purely decorative. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(90%_70%_at_15%_110%,rgba(0,32,245,.55),transparent_60%),radial-gradient(60%_40%_at_85%_-10%,rgba(43,70,255,.25),transparent_60%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[.22] [background-image:radial-gradient(rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:26px_26px]"
        />
        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0020f5] shadow-[0_10px_30px_-8px_rgba(0,32,245,.7)]">
            <img src="/7xlogo.svg" alt="7X" className="h-4 w-auto" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-white">Dialog</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-balance text-4xl font-bold leading-[1.08] tracking-tight text-white">
            One console for every conversational agent.
          </h2>
          <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-white/60">
            Configure journeys, watch conversations as they happen, and act on what customers need.
          </p>
        </div>

        <p className="relative text-[13px] text-white/40">Agents, conversations, analytics and governance in one place.</p>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[360px] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
          {/* Compact brand mark for small screens where the panel is hidden. */}
          <span className="mb-8 grid h-11 w-11 place-items-center rounded-xl bg-[#0020f5] shadow-[0_10px_24px_-6px_rgba(0,32,245,.5)] lg:hidden">
            <img src="/7xlogo.svg" alt="7X" className="h-[17px] w-auto" />
          </span>

          <h1 className="text-[22px] font-bold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted">Access the Dialog admin console.</p>

          <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-password">Password</Label>
              <div className="relative">
                <Input
                  id="admin-password"
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                  autoFocus
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="pr-11"
                  aria-invalid={Boolean(error)}
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted transition-colors hover:text-ink"
                >
                  {reveal ? <EyeOff size={17} strokeWidth={2} /> : <Eye size={17} strokeWidth={2} />}
                </button>
              </div>
              {capsLock ? <span className="text-xs font-medium text-amber-600">Caps Lock is on.</span> : null}
            </div>

            {error ? (
              <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">
                {error}
              </div>
            ) : null}

            <Button type="submit" disabled={busy || !password} className="h-11 w-full text-sm">
              {busy ? (
                <>
                  <span
                    aria-hidden
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none"
                  />
                  Signing in
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight size={16} strokeWidth={2.2} />
                </>
              )}
            </Button>
          </form>

          {ssoEnabled ? (
            <>
              <div className="my-6 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-muted">
                <span className="h-px flex-1 bg-[var(--color-line)]" />
                or
                <span className="h-px flex-1 bg-[var(--color-line)]" />
              </div>
              <Button
                variant="outline"
                className="h-11 w-full text-sm"
                onClick={() => (window.location.href = "/api/admin/sso/login")}
              >
                {/* Official Microsoft four-square mark (brand asset, not decoration). */}
                <svg width="15" height="15" viewBox="0 0 21 21" aria-hidden>
                  <rect x="0" y="0" width="10" height="10" fill="#f25022" />
                  <rect x="11" y="0" width="10" height="10" fill="#7fba00" />
                  <rect x="0" y="11" width="10" height="10" fill="#00a4ef" />
                  <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
                </svg>
                Continue with Microsoft
              </Button>
            </>
          ) : null}

          <p className={cn("mt-8 text-[13px] text-muted", ssoEnabled && "mt-6")}>
            Access is limited to the 7X operations team.
          </p>
        </div>
      </main>
    </div>
  );
}
