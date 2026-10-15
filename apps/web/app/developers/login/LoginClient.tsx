"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Mark } from "@/components/developers/Mark";

/**
 * Where a successful sign-in lands: a path inside this portal, or its
 * applications page. "/developers/console" is fine. "https://evil.example" is
 * not, nor "//evil.example" (protocol-relative, another host), nor anything
 * outside /developers: the login page must not be a way to send someone
 * somewhere else with the credibility of having just signed in.
 */
export function sameSitePath(next: string | null | undefined): string {
  if (!next || next.startsWith("//") || next.startsWith("/\\")) return "/developers/apps";
  if (next !== "/developers" && !next.startsWith("/developers/") && !next.startsWith("/developers?")) return "/developers/apps";
  return next;
}

const PANEL_LINES: [string, string][] = [
  ["Protocol", "A2A 1.0, JSON-RPC and REST"],
  ["Credentials", "OAuth client and API key per application"],
  ["Request log", "Every call, with status and latency"],
  ["Environment", "Sandbox. Test data only"],
];

export function LoginClient({ initialEmail = "" }: { initialEmail?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/developers/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) return setError("Too many requests. Wait a few minutes and try again.");
      if (res.status === 502) return setError("The code could not be sent. Try again, or contact your 7X representative.");
      if (!res.ok) return setError("Enter a valid email address.");
      setStep("code");
      setCode("");
      setWait(60);
      setNotice(`If ${email.trim()} has an account, a six-digit code is on its way. It expires in 10 minutes.`);
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/developers/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          body.error === "expired"
            ? "This code has expired. Send a new one."
            : body.error === "too_many_attempts"
              ? "Too many wrong attempts. Send a new code."
              : "That code is not correct. Check the latest email and try again."
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
    <div className="mx-auto grid w-full max-w-[1000px] border border-[var(--color-line)] bg-white lg:grid-cols-[1fr_1fr]">
      <aside className="hidden flex-col justify-between bg-[#0f1720] p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <Mark size={30} />
          <span className="text-[14.5px] font-semibold">
            Dialog <span className="font-normal text-white/60">Developers</span>
          </span>
        </div>

        <div>
          <h2 className="max-w-[18ch] text-[28px] font-semibold leading-[1.2]">Integrate with Dialog agents over A2A.</h2>
          <dl className="mt-8 border-t border-white/15">
            {PANEL_LINES.map(([term, desc]) => (
              <div key={term} className="grid grid-cols-[132px_1fr] gap-4 border-b border-white/15 py-3.5 text-[13px]">
                <dt className="text-white/55">{term}</dt>
                <dd className="text-white/90">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-[12px] text-white/45">7X Innovation Studio, Emirates Post Group</p>
      </aside>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10 lg:py-14" aria-labelledby="login-title">
        <div className="w-full max-w-[360px]">
          <span className="mb-7 inline-block lg:hidden">
            <Mark size={36} />
          </span>
          <h1 id="login-title" className="text-[22px] font-semibold text-ink">
            {step === "email" ? "Sign in" : "Enter your code"}
          </h1>
          <p className="mt-1.5 text-[14px] text-muted">
            {step === "email" ? "We will email you a one-time code. No password is needed." : <>Sent to <span className="font-medium text-ink">{email.trim()}</span></>}
          </p>

          {step === "email" ? (
            <form onSubmit={sendCode} className="mt-7 flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dev-email">Work email</Label>
                <Input
                  id="dev-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@organisation.gov.ae"
                  className="h-11"
                />
              </div>
              <Button type="submit" disabled={busy || !email.trim()} className="h-11 w-full text-[14px]">
                {busy ? "Sending" : "Send code"}
                {!busy ? <ArrowRight size={16} strokeWidth={1.75} /> : null}
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="mt-7 flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dev-code">Six-digit code</Label>
                <Input
                  ref={codeRef}
                  id="dev-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="mono h-12 text-center text-[22px] tracking-[0.4em]"
                  aria-describedby="dev-code-help"
                />
                <span id="dev-code-help" className="text-[12.5px] text-muted">
                  The code expires in 10 minutes. Check your spam folder if it has not arrived.
                </span>
              </div>
              <Button type="submit" disabled={busy || code.length !== 6} className="h-11 w-full text-[14px]">
                {busy ? "Verifying" : "Sign in"}
              </Button>
              <div className="flex items-center justify-between text-[13px]">
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setError(null);
                    setNotice(null);
                  }}
                  className="text-muted hover:text-ink"
                >
                  Use a different email
                </button>
                <button type="button" disabled={wait > 0 || busy} onClick={() => void sendCode()} className="font-medium text-[#1330f0] hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline">
                  {wait > 0 ? `Resend in ${wait}s` : "Send a new code"}
                </button>
              </div>
            </form>
          )}

          <div aria-live="polite" className="mt-4 empty:hidden">
            {error ? <p role="alert" className="border border-[#fecdca] bg-[#fef3f2] px-3.5 py-2.5 text-[13px] text-[#b42318]">{error}</p> : null}
            {!error && notice ? <p className="border border-[var(--color-line)] bg-[var(--color-canvas)] px-3.5 py-2.5 text-[13px] text-ink-2">{notice}</p> : null}
          </div>

          <p className="mt-8 border-t border-[var(--color-line)] pt-5 text-[12.5px] leading-relaxed text-muted">
            Accounts are created by 7X for each integrating organisation. To request access, contact your 7X representative.
          </p>
        </div>
      </section>
    </div>
  );
}
