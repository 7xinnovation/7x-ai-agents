"use client";

import { useState } from "react";
import { Eye, EyeOff, ArrowRight, ShieldCheck, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

/** The shortest password we will take, and the reason it is not shorter. */
const MIN = 8;

export function AcceptInvite({
  token,
  name,
  email,
  valid,
}: {
  token: string;
  name: string | null;
  email: string | null;
  valid: boolean;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN && confirm === password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        setError(
          res.status === 400
            ? "This invitation is no longer valid. Ask whoever invited you to send a new one."
            : "Something went wrong. Try again in a moment."
        );
        return;
      }
      // Already signed in by the response's cookie.
      window.location.href = "/admin";
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--color-line-soft)] px-5 py-12">
      <div className="w-full max-w-[400px]">
        <span className="mb-8 grid h-11 w-11 place-items-center rounded-xl bg-[#0020f5] shadow-[0_10px_24px_-6px_rgba(0,32,245,.5)]">
          <img src="/7xlogo.svg" alt="7X" className="h-[17px] w-auto" />
        </span>

        {!valid ? (
          <div className="rounded-2xl border border-[var(--color-line)] bg-surface p-6 shadow-[var(--shadow-xs)]">
            <MailWarning className="h-6 w-6 text-amber-500" />
            <h1 className="mt-3 text-[20px] font-bold tracking-tight text-ink">This invitation has expired</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              Invitation links work once and expire after seven days. Ask whoever invited you to send a new one — your
              account is not active until a link is used.
            </p>
            <a
              href="/admin/login"
              className="mt-5 inline-flex h-10 items-center rounded-lg border border-[var(--color-line)] px-3.5 text-[13.5px] font-semibold hover:bg-[var(--color-line-soft)]"
            >
              Go to sign in
            </a>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--color-line)] bg-surface p-6 shadow-[var(--shadow-xs)]">
            <h1 className="text-[22px] font-bold tracking-tight text-ink">Welcome{name ? `, ${name.split(" ")[0]}` : ""}</h1>
            <p className="mt-1.5 text-[14px] text-muted">
              Choose a password for <b className="font-semibold text-ink">{email}</b> to finish setting up your account.
            </p>

            <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-password">Password</Label>
                <div className="relative">
                  <Input
                    id="invite-password"
                    type={reveal ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                    autoComplete="new-password"
                    autoFocus
                    placeholder={`At least ${MIN} characters`}
                    className="h-11 pr-11"
                    aria-invalid={tooShort}
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
                {tooShort ? <span className="text-xs font-medium text-amber-600">Use at least {MIN} characters.</span> : null}
                {capsLock ? <span className="text-xs font-medium text-amber-600">Caps Lock is on.</span> : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-confirm">Confirm password</Label>
                <Input
                  id="invite-confirm"
                  type={reveal ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Type it again"
                  className="h-11"
                  aria-invalid={mismatch}
                />
                {mismatch ? <span className="text-xs font-medium text-amber-600">These do not match.</span> : null}
              </div>

              {error ? (
                <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">
                  {error}
                </div>
              ) : null}

              <Button type="submit" disabled={busy || !ready} className="h-11 w-full text-sm">
                {busy ? (
                  <>
                    <span
                      aria-hidden
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none"
                    />
                    Setting up
                  </>
                ) : (
                  <>
                    Create my account
                    <ArrowRight size={16} strokeWidth={2.2} />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-5 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
              This link works once. Nobody else — including whoever invited you — ever sees the password you choose.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
