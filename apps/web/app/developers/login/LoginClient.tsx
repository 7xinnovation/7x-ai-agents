"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Mark } from "@/components/developers/Mark";

/**
 * Where a successful sign-in lands: a path inside this portal, or its
 * applications page. "/developers/console" is fine. "https://evil.example" is
 * not, nor "//evil.example" (protocol-relative, another host), nor anything
 * outside /developers — the login page must not be a way to send someone
 * somewhere else with the credibility of having just signed in.
 */
export function sameSitePath(next: string | null | undefined): string {
  if (!next || next.startsWith("//") || next.startsWith("/\\")) return "/developers/apps";
  if (next !== "/developers" && !next.startsWith("/developers/") && !next.startsWith("/developers?")) return "/developers/apps";
  return next;
}

const PANEL_LINES: [string, string][] = [
  ["A2A 1.0", "JSON-RPC and REST bindings, one Agent Card"],
  ["Credentials you control", "An OAuth client and an API key per application; rotate or revoke at any time"],
  ["Every call to the agent in your request log", "Method, binding, status, latency and the task it touched"],
];

export function LoginClient() {
  const [email, setEmail] = useState("");
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
      const res = await fetch("/api/developers/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? "Too many attempts. Wait a moment and try again."
            : res.status === 401
              ? "Incorrect email or password."
              : `Sign-in failed (HTTP ${res.status}). Try again.`
        );
        return;
      }
      window.location.assign(sameSitePath(new URLSearchParams(window.location.search).get("next")));
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-rise className="mx-auto grid w-full max-w-[1040px] overflow-hidden rounded-2xl border border-[var(--color-line)] bg-surface shadow-[var(--shadow-sm)] lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel: a composition element of the light theme, not a theme flip. */}
      <aside className="relative hidden overflow-hidden bg-[#06070c] lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(90%_70%_at_15%_110%,rgba(0,32,245,.55),transparent_60%),radial-gradient(60%_40%_at_85%_-10%,rgba(43,70,255,.25),transparent_60%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[.22] [background-image:radial-gradient(rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:26px_26px]"
        />
        <div className="relative flex items-center gap-3">
          <Mark size={36} />
          <span className="text-[15px] font-semibold tracking-tight text-white">
            Dialog <span className="font-normal text-white/55">Developers</span>
          </span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-balance text-[36px] font-bold leading-[1.08] tracking-[-0.02em] text-white">One doorway to every Dialog agent.</h2>
          <p className="mt-4 max-w-[42ch] text-[14.5px] leading-relaxed text-white/55">
            Create an application, take a token, send a task. The agent runs the journey and reports its state until it is done.
          </p>
          <dl className="mt-9 max-w-sm">
            {PANEL_LINES.map(([term, desc]) => (
              <div key={term} className="border-t border-white/10 py-3.5 first:border-t-0">
                <dt className="text-[13.5px] font-semibold text-white/90">{term}</dt>
                <dd className="mt-0.5 text-[12.5px] text-white/45">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-[12.5px] text-white/35">7X Dialog · A2A protocol 1.0 · sandbox</p>
      </aside>

      {/* Form panel */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10 lg:py-14" aria-labelledby="login-title">
        <div className="w-full max-w-[360px]">
          <span className="mb-7 inline-block lg:hidden">
            <Mark size={40} />
          </span>

          <h1 id="login-title" className="text-[22px] font-bold tracking-tight text-ink">
            Sign in
          </h1>
          <p className="mt-1.5 text-sm text-muted">Dialog Developers: your applications, the console and your request log.</p>

          <form onSubmit={submit} className="mt-7 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dev-email">Email</Label>
              <Input
                id="dev-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="you@organisation.gov.ae"
                className="h-11"
                aria-invalid={Boolean(error)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dev-password">Password</Label>
              <div className="relative">
                <Input
                  id="dev-password"
                  name="password"
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                  autoComplete="current-password"
                  placeholder="Your password"
                  className="h-11 pr-11"
                  aria-invalid={Boolean(error)}
                  aria-describedby={capsLock ? "dev-capslock" : undefined}
                  required
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? "Hide password" : "Show password"}
                  aria-pressed={reveal}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted outline-none transition-colors hover:text-ink focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
                >
                  {reveal ? <EyeOff size={17} strokeWidth={2} /> : <Eye size={17} strokeWidth={2} />}
                </button>
              </div>
              {capsLock ? (
                <span id="dev-capslock" className="text-xs font-medium text-amber-700">
                  Caps Lock is on.
                </span>
              ) : null}
            </div>

            <div aria-live="polite" aria-atomic="true">
              {error ? (
                <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">
                  {error}
                </div>
              ) : null}
            </div>

            <Button type="submit" disabled={busy || !email || !password} className="h-11 w-full text-sm">
              {busy ? (
                <>
                  <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" />
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

          <p className="mt-8 text-[13px] leading-relaxed text-muted">
            Accounts are created by invitation. If you were invited, use the link in your invitation to set a password first. For a new account or a
            lost password, ask your 7X contact.
          </p>
        </div>
      </section>
    </div>
  );
}
