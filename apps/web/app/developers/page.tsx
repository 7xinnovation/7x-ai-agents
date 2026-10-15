import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, Activity, BookOpen, KeyRound, TerminalSquare } from "lucide-react";
import { currentDeveloper, type DeveloperClaims } from "@/lib/developer/session";
import { usageSummary } from "@/lib/developer/accounts";
import { A2A_AGENTS, CITIZEN_IDENTITY_EXTENSION, DEFAULT_AGENT_KEY } from "@/lib/a2a/catalogue";
import { CodeBlock } from "@/components/developers/CodeBlock";
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
    { label: "Requests in the last 24 hours", value: usage.requests24h },
    { label: "Errors in the last 24 hours", value: usage.errors24h, attention: usage.errors24h > 0 },
    { label: "Tasks created", value: usage.tasks },
    { label: "Tasks open", value: usage.openTasks },
  ];
  const shortcuts = [
    { href: "/developers/apps", icon: KeyRound, title: "Applications", text: "Create credentials, rotate them or revoke them." },
    { href: "/developers/console", icon: TerminalSquare, title: "Console", text: "Send a task from the browser and follow it to completion." },
    { href: "/developers/activity", icon: Activity, title: "Activity", text: "Every task your applications created and every call they made." },
    { href: "/developers/docs", icon: BookOpen, title: "Documentation", text: "Both bindings, the extensions, the states and every error code." },
  ];
  return (
    <div>
      <h1 className="text-[24px] text-ink">{dev.org}</h1>
      <p className="mt-1 text-[14px] text-muted">Signed in as {dev.name}, {dev.email}</p>

      <section aria-label="Usage" className="mt-8 grid grid-cols-2 border border-[var(--color-line)] bg-white lg:grid-cols-4">
        {tiles.map((t, i) => (
          <div
            key={t.label}
            className={cn(
              "px-5 py-5",
              i % 2 === 1 && "border-l border-[var(--color-line)]",
              i >= 2 && "border-t border-[var(--color-line)] lg:border-t-0",
              i === 2 && "lg:border-l"
            )}
          >
            <div className="text-[12.5px] text-muted">{t.label}</div>
            <div className={cn("mt-2 text-[28px] font-semibold leading-none tabular-nums", t.attention ? "text-[#b42318]" : "text-ink")}>{number.format(t.value)}</div>
          </div>
        ))}
      </section>

      <section aria-label="Go to" className="mt-10">
        <h2 className="text-[15px] font-semibold text-ink">Go to</h2>
        <ul className="mt-3 grid border-t border-[var(--color-line)] sm:grid-cols-2">
          {shortcuts.map((s) => (
            <li key={s.href} className="border-b border-[var(--color-line)] sm:odd:border-r">
              <Link
                href={s.href}
                className="group flex items-start gap-4 px-1 py-5 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] sm:px-5"
              >
                <s.icon size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#1330f0]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-medium text-ink">{s.title}</span>
                  <span className="mt-0.5 block text-[13.5px] text-ink-2">{s.text}</span>
                </span>
                <ArrowRight size={16} strokeWidth={1.75} className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ─── Signed out ──────────────────────────────────────────────────────────────

function Landing({ origin }: { origin: string }) {
  const agent = A2A_AGENTS[DEFAULT_AGENT_KEY]!;
  const facts: [string, React.ReactNode][] = [
    ["Protocol", "A2A 1.0 (Linux Foundation)"],
    ["Bindings", "JSON-RPC 2.0, HTTP+JSON, server-sent events"],
    ["Authentication", "OAuth 2.0 client credentials, or an API key"],
    ["Agent", <span key="a" className="mono text-[12.5px]">/a2a/{agent.key}</span>],
    ["Environment", "Staging. Emirates Post reference data, simulated orders, mock payments"],
    ["Access", "By invitation from 7X"],
  ];
  const steps: { title: string; text: string; code: string; codeTitle: string }[] = [
    {
      title: "Request a token",
      text: "Exchange your application's client ID and secret. The token lasts one hour. An API key in X-API-Key works too.",
      codeTitle: "POST /a2a/oauth/token",
      code: `curl -X POST ${origin}/a2a/oauth/token \\
  -u "CLIENT_ID:CLIENT_SECRET" \\
  -d grant_type=client_credentials \\
  -d scope=tasks`,
    },
    {
      title: "Send a task",
      text: "One JSON-RPC call opens a conversation and a task. The citizen's identity travels inside the message.",
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
    {
      title: "Follow it to completion",
      text: "Answer the agent's questions in the same task, settle the sandbox payment, and read the outcome from the task's artifacts.",
      codeTitle: "GetTask",
      code: `curl ${origin}/a2a/${agent.key} \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "jsonrpc": "2.0", "id": "2", "method": "GetTask", "params": { "id": "TASK_ID" } }'`,
    },
  ];

  return (
    <div>
      <section className="grid gap-10 border-b border-[var(--color-line)] pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-16">
        <div className="max-w-[600px]">
          <h1 className="text-[32px] leading-[1.15] text-ink sm:text-[38px]">Emirates Post PO Box agent, available over A2A</h1>
          <p className="mt-5 max-w-[56ch] text-[16px] leading-relaxed text-ink-2">
            Rent and renew PO Boxes from your own agent, end to end, against a sandbox that behaves like production.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/developers/login"
              className="inline-flex h-10 items-center gap-2 rounded-[3px] bg-[#1330f0] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#0f27c4] active:translate-y-px focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
            >
              Sign in
              <ArrowRight size={16} strokeWidth={1.75} />
            </Link>
            <Link
              href="/developers/docs"
              className="inline-flex h-10 items-center rounded-[3px] border border-[#c9cfd6] bg-white px-5 text-[14px] font-medium text-ink transition-colors hover:border-ink active:translate-y-px focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
            >
              Read the documentation
            </Link>
          </div>
        </div>

        <aside aria-label="The sandbox at a glance" className="border border-[var(--color-line)] bg-white">
          <h2 className="border-b border-[var(--color-line)] px-5 py-3 text-[13px] font-semibold text-ink">The sandbox at a glance</h2>
          <dl className="px-5 py-1 text-[13px]">
            {facts.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[112px_1fr] gap-4 border-b border-[var(--color-line-soft)] py-2.5 last:border-b-0">
                <dt className="text-muted">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </section>

      <section aria-labelledby="integrate" className="mt-12">
        <h2 id="integrate" className="text-[20px] font-semibold text-ink">
          Integrate in three calls
        </h2>
        <p className="mt-1.5 max-w-[60ch] text-[14px] text-ink-2">Create an application after you sign in to get the client ID, secret and API key used below.</p>
        <ol className="mt-6 border-t border-[var(--color-line)]">
          {steps.map((s, i) => (
            <li key={s.title} className="grid gap-4 border-b border-[var(--color-line)] py-7 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:gap-12">
              <div>
                <h3 className="text-[15px] font-semibold text-ink">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{s.text}</p>
              </div>
              <CodeBlock code={s.code} title={s.codeTitle} lang="bash" className="min-w-0" />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="skills" className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="skills" className="text-[20px] font-semibold text-ink">
            What the agent does
          </h2>
          <a href="/.well-known/agent-card.json" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[#1330f0] hover:underline">
            View the Agent Card
            <ArrowRight size={14} strokeWidth={1.75} />
          </a>
        </div>
        <ul className="mt-5 grid border-l border-t border-[var(--color-line)] bg-white sm:grid-cols-2">
          {agent.skills.map((sk) => (
            <li key={sk.id} className="border-b border-r border-[var(--color-line)] p-5">
              <h3 className="text-[14.5px] font-semibold text-ink">{sk.name}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{sk.description}</p>
              <p className="mono mt-3 text-[11.5px] text-muted">{sk.id}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="personas" className="mt-14">
        <h2 id="personas" className="text-[20px] font-semibold text-ink">
          Test identities
        </h2>
        <p className="mt-1.5 max-w-[66ch] text-[14px] text-ink-2">
          The sandbox stands in for UAE PASS with two personas. Name one in the message metadata and it applies to the whole conversation.
        </p>
        <div className="mt-5 overflow-x-auto border border-[var(--color-line)] bg-white">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="border-b border-[var(--color-line)] bg-[var(--color-canvas)] text-[12.5px] text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Persona</th>
                <th className="px-5 py-2.5 font-medium">Signed in</th>
                <th className="px-5 py-2.5 font-medium">What it can do</th>
              </tr>
            </thead>
            <tbody>
              {agent.personas.map((p) => (
                <tr key={p.id} className="border-b border-[var(--color-line-soft)] align-top last:border-b-0">
                  <td className="mono whitespace-nowrap px-5 py-3 text-[12.5px] text-ink">{p.id}</td>
                  <td className="px-5 py-3 text-ink-2">{p.signedIn ? "Yes, UAE PASS" : "No"}</td>
                  <td className="px-5 py-3 leading-relaxed text-ink-2">{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
