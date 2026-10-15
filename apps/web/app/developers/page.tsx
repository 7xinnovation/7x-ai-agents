import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, Activity, BookOpen, KeyRound, TerminalSquare } from "lucide-react";
import { currentDeveloper, type DeveloperClaims } from "@/lib/developer/session";
import { usageSummary } from "@/lib/developer/accounts";
import { A2A_AGENTS, CITIZEN_IDENTITY_EXTENSION, DEFAULT_AGENT_KEY } from "@/lib/a2a/catalogue";
import { CodeBlock } from "@/components/developers/CodeBlock";
import { Badge } from "@/components/ui/field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The portal's front page. Signed in, it is a short dashboard: who you are,
 * what your applications did in the last day, and where to go next. Signed
 * out, it says what the sandbox is and how a call reaches it, in three steps
 * a developer can paste.
 */
export default async function DevelopersOverview() {
  const dev = await currentDeveloper();
  if (dev) return <SignedIn dev={dev} usage={await usageSummary(dev.aid)} />;
  return <Landing origin={await requestOrigin()} />;
}

/** The origin the page was served from, so every sample points at this deployment. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "agent.7x.ae";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https");
  return `${proto}://${host}`;
}

// ─── Signed in ───────────────────────────────────────────────────────────────

const number = new Intl.NumberFormat("en-GB");

function SignedIn({ dev, usage }: { dev: DeveloperClaims; usage: Awaited<ReturnType<typeof usageSummary>> }) {
  const tiles: { label: string; value: number; attention?: boolean }[] = [
    { label: "Requests, 24 h", value: usage.requests24h },
    { label: "Errors, 24 h", value: usage.errors24h, attention: usage.errors24h > 0 },
    { label: "Tasks", value: usage.tasks },
    { label: "Open tasks", value: usage.openTasks },
  ];
  const shortcuts = [
    { href: "/developers/apps", icon: KeyRound, title: "Applications", text: "Create an application, rotate or revoke its credentials." },
    { href: "/developers/console", icon: TerminalSquare, title: "Console", text: "Send a task to the sandbox agent from the browser and follow it." },
    { href: "/developers/docs", icon: BookOpen, title: "Documentation", text: "The protocol, both bindings, the extensions and every error code." },
  ];
  return (
    <div data-rise>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink">Welcome, {dev.name}</h1>
          <p className="mt-1 text-[14px] text-muted">
            {dev.org} · <span className="mono text-[13px]">{dev.email}</span>
          </p>
        </div>
        <Link href="/developers/activity" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-brand hover:underline">
          <Activity size={15} strokeWidth={2} />
          View activity
        </Link>
      </div>

      <section aria-label="Usage" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-[var(--color-line)] bg-surface px-5 py-4 shadow-[var(--shadow-xs)]">
            <div className="text-[12.5px] font-medium text-muted">{t.label}</div>
            <div className={cn("mt-1.5 text-[30px] font-semibold leading-none tracking-tight", t.attention ? "text-[#b42318]" : "text-ink")}>{number.format(t.value)}</div>
          </div>
        ))}
      </section>

      <section aria-label="Shortcuts" className="mt-8 grid gap-3 md:grid-cols-3">
        {shortcuts.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex flex-col gap-3 rounded-xl border border-[var(--color-line)] bg-surface p-5 shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--color-ring)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
          >
            <s.icon size={18} strokeWidth={2} className="text-brand" />
            <div>
              <div className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
                {s.title}
                <ArrowRight size={14} strokeWidth={2.2} className="text-muted transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{s.text}</p>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

// ─── Signed out ──────────────────────────────────────────────────────────────

function Landing({ origin }: { origin: string }) {
  const agent = A2A_AGENTS[DEFAULT_AGENT_KEY]!;
  const steps: { title: string; text: string; code: string; codeTitle: string }[] = [
    {
      title: "Create an application and get credentials",
      text: "In Applications, create one. It gets an OAuth client (client_id and client_secret) and an API key, shown once. The Agent Card tells your client where to send tasks and how to authenticate; it needs no credentials to read.",
      codeTitle: "Agent Card",
      code: `curl ${origin}/.well-known/agent-card.json`,
    },
    {
      title: "Exchange them for a token",
      text: "Client-credentials grant, scope tasks. The reply carries access_token, token_type Bearer and expires_in 3600; request a new token when it expires. The API key works too, as X-API-Key, for a quick test.",
      codeTitle: "Token",
      code: `curl -X POST ${origin}/a2a/oauth/token \\
  -u "CLIENT_ID:CLIENT_SECRET" \\
  -d grant_type=client_credentials \\
  -d scope=tasks`,
    },
    {
      title: "Send a task and follow it to completion",
      text: "One JSON-RPC call starts the task. The citizen's identity travels inside the message as a sandbox persona. The reply carries the task and its state; call GetTask with the task's id, or use SendStreamingMessage, until the state is terminal.",
      codeTitle: "SendMessage",
      code: `curl ${origin}/a2a/${agent.key} \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "SendMessage",
    "params": {
      "message": {
        "role": "ROLE_USER",
        "messageId": "msg-1",
        "parts": [{ "text": "Renew my PO Box 50500 in Dubai for one more year" }],
        "metadata": {
          "${CITIZEN_IDENTITY_EXTENSION}": { "persona": "ahmed-al-mansoori" }
        }
      }
    }
  }'`,
    },
  ];

  return (
    <div data-rise>
      <section className="max-w-[760px]">
        <p className="text-[12.5px] font-semibold uppercase tracking-wide text-brand">A2A protocol 1.0 · Sandbox</p>
        <h1 className="mt-3 max-w-[20ch] text-[34px] font-bold leading-[1.08] tracking-tight text-ink sm:text-[42px]">The task doorway to Dialog agents</h1>
        <p className="mt-5 max-w-[66ch] text-[15.5px] leading-relaxed text-ink-2">
          Dialog is 7X&apos;s platform for conversational government services. This sandbox exposes one of its agents, Emirates Post PO Box rental
          and renewal, over the Agent-to-Agent protocol: your agent sends a task, ours runs the journey and reports its state until the box is
          renewed or rented. The Emirates Post session is simulated and the checkout is a payable mock. No real box is rented and no money
          moves.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href="/developers/login"
            className="inline-flex h-[40px] items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white shadow-[var(--shadow-xs)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-brand)_90%,#000)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
          >
            Sign in
            <ArrowRight size={16} strokeWidth={2.2} />
          </Link>
          <Link
            href="/developers/docs"
            className="inline-flex h-[40px] items-center gap-2 rounded-lg border border-[var(--color-line)] bg-surface px-4 text-[14px] font-semibold text-ink-2 shadow-[var(--shadow-xs)] transition-colors hover:bg-[var(--color-canvas)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
          >
            Read the docs
          </Link>
        </div>
        <p className="mt-4 text-[13px] text-muted">Access is by invitation: 7X provisions an account for each integrating organisation. There is no self sign-up.</p>
      </section>

      <section aria-labelledby="how" className="mt-14">
        <h2 id="how" className="text-[20px] font-semibold tracking-tight text-ink">
          How it works
        </h2>
        <ol className="mt-5 flex flex-col divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {steps.map((s, i) => (
            <li key={s.title} className="grid gap-4 py-7 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] md:gap-10">
              <div className="flex gap-4">
                <span className="mono mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--color-line)] bg-surface text-[12.5px] font-semibold text-ink" aria-hidden>
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[15.5px] font-semibold leading-snug text-ink">
                    <span className="sr-only">Step {i + 1}: </span>
                    {s.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{s.text}</p>
                </div>
              </div>
              <CodeBlock code={s.code} title={s.codeTitle} lang="bash" className="min-w-0" />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="agent" className="mt-14">
        <h2 id="agent" className="text-[20px] font-semibold tracking-tight text-ink">
          The agent
        </h2>
        <Card className="mt-5">
          <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <CardTitle>{agent.name}</CardTitle>
              <p className="mt-0.5 text-[12.5px] text-muted">
                <span className="mono">/a2a/{agent.key}</span> · version <span className="mono">{agent.version}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {agent.sandbox ? <Badge tone="draft" dot>Sandbox</Badge> : <Badge tone="live" dot>Live</Badge>}
              <Badge tone="muted">JSON-RPC</Badge>
              <Badge tone="muted">REST</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="max-w-[80ch] text-[14px] leading-relaxed text-ink-2">{agent.description}</p>

            <h4 className="mt-6 text-[12.5px] font-semibold uppercase tracking-wide text-muted">Skills</h4>
            <ul className="mt-3 grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {agent.skills.map((sk) => (
                <li key={sk.id} className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[14px] font-semibold text-ink">{sk.name}</span>
                    <span className="mono text-[11.5px] text-muted">{sk.id}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{sk.description}</p>
                  {sk.examples?.[0] ? <p className="mt-1.5 text-[12.5px] text-muted">e.g. &ldquo;{sk.examples[0]}&rdquo;</p> : null}
                </li>
              ))}
            </ul>

            <h4 className="mt-7 text-[12.5px] font-semibold uppercase tracking-wide text-muted">Sandbox personas</h4>
            <ul className="mt-3 flex flex-col gap-2">
              {agent.personas.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-relaxed text-ink-2">
                  <span className="mono text-[12.5px] text-ink">{p.id}</span>
                  <span className="text-muted">{p.signedIn ? "signed in" : "guest"}</span>
                  <span className="basis-full sm:basis-auto">{p.description}</span>
                </li>
              ))}
            </ul>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--color-line-soft)] pt-5 text-[13px]">
              <a href="/.well-known/agent-card.json" className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                Agent Card (JSON)
                <ArrowRight size={13} strokeWidth={2.2} />
              </a>
              <span className="min-w-0 break-all text-muted">
                JSON-RPC <span className="mono text-ink-2">{origin}/a2a/{agent.key}</span>
              </span>
              <span className="min-w-0 break-all text-muted">
                REST <span className="mono text-ink-2">{origin}/a2a/{agent.key}/rest</span>
              </span>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
