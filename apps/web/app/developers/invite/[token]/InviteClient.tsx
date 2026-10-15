"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const MIN = 10;

/**
 * A plain reading of a password: long enough, and drawn from more than one
 * kind of character. Length carries most of the weight; variety the rest.
 */
function strength(pw: string): { level: 0 | 1 | 2 | 3; label: string } {
  if (pw.length < MIN) return { level: 0, label: `At least ${MIN} characters` };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  const score = (pw.length >= 14 ? 1 : 0) + (pw.length >= 20 ? 1 : 0) + (kinds >= 3 ? 1 : 0);
  if (score >= 2) return { level: 3, label: "Strong" };
  if (score === 1) return { level: 2, label: "Fair" };
  return { level: 1, label: "Acceptable" };
}

export function InviteClient({ token, email, name, organization }: { token: string; email: string; name: string; organization: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const s = strength(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN && confirm === password && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/developers/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.status === 404) {
        setError("This invitation is no longer valid. It may have been used already or expired. Ask your 7X contact for a new one.");
        return;
      }
      if (res.status === 400) {
        setError(`The password must be at least ${MIN} characters.`);
        return;
      }
      if (!res.ok) {
        setError(`The password could not be set (HTTP ${res.status}). Try again.`);
        return;
      }
      setDone(true);
      window.location.assign("/developers/apps");
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[460px] py-6 sm:py-10">
      <h1 className="text-[22px] font-semibold text-ink">Set your password</h1>
      <p className="mt-1.5 text-sm text-muted">You were invited to Dialog Developers. Choose a password to finish creating the account.</p>

      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 rounded-xl border border-[var(--color-line)] bg-surface px-4 py-3.5 text-[13.5px] ">
        <dt className="text-muted">Organisation</dt>
        <dd className="font-medium text-ink">{organization}</dd>
        <dt className="text-muted">Name</dt>
        <dd className="font-medium text-ink">{name}</dd>
        <dt className="text-muted">Email</dt>
        <dd className="mono break-all text-[13px] text-ink">{email}</dd>
      </dl>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        {/* The email is in the form, read-only, so password managers store it with the password. */}
        <input type="email" name="username" value={email} readOnly autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-password">Password</Label>
          <div className="relative">
            <Input
              id="inv-password"
              name="new-password"
              type={reveal ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="new-password"
              minLength={MIN}
              className="h-11 pr-11"
              aria-describedby="inv-strength"
              aria-invalid={Boolean(error)}
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
          <div id="inv-strength" className="flex items-center gap-3">
            <div className="flex flex-1 gap-1" aria-hidden>
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    s.level >= n ? (s.level === 1 ? "bg-[#f79009]" : "bg-brand") : "bg-[var(--color-line)]"
                  )}
                />
              ))}
            </div>
            <span className={cn("text-xs", password.length === 0 ? "text-muted" : s.level === 0 ? "text-[#b42318]" : "text-ink-2")}>
              {password.length === 0 ? `At least ${MIN} characters` : s.label}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-confirm">Confirm password</Label>
          <Input
            id="inv-confirm"
            name="confirm-password"
            type={reveal ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="h-11"
            aria-invalid={mismatch}
            aria-describedby={mismatch ? "inv-mismatch" : undefined}
            required
          />
          {mismatch ? (
            <span id="inv-mismatch" className="text-xs font-medium text-[#b42318]">
              The two passwords do not match.
            </span>
          ) : null}
        </div>

        <div aria-live="polite" aria-atomic="true">
          {error ? (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">
              {error}
            </div>
          ) : null}
          {done ? <p className="text-[13px] text-ink-2">Password set. Taking you to your applications.</p> : null}
        </div>

        <Button type="submit" disabled={!ready} className="h-11 w-full text-sm">
          {busy ? (
            <>
              <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" />
              Setting password
            </>
          ) : (
            <>
              Set password and continue
              <ArrowRight size={16} strokeWidth={2.2} />
            </>
          )}
        </Button>
      </form>

      <p className="mt-6 text-[12.5px] leading-relaxed text-muted">This link works once. After the password is set you are signed in, and the link stops working.</p>
    </div>
  );
}
