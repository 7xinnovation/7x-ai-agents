import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentDeveloper } from "@/lib/developer/session";
import { listApps } from "@/lib/developer/accounts";
import { A2A_AGENTS, CITIZEN_IDENTITY_EXTENSION, DEFAULT_AGENT_KEY, DIALOG_REPLY_EXTENSION } from "@/lib/a2a/catalogue";
import { ConsoleClient } from "./ConsoleClient";

export const metadata: Metadata = {
  title: "Console",
  description: "Talk to the sandbox agent over A2A from the browser, with your application's token, and watch the task as it moves.",
};

export const dynamic = "force-dynamic";

/**
 * The Console: a signed-in developer talks to the sandbox agent through the
 * same doorway an integration uses. The page loads the account's applications
 * and the agent's entry; everything else happens in the browser against the
 * A2A endpoints, with a one-hour token minted by the portal.
 */
export default async function ConsolePage() {
  const dev = await currentDeveloper();
  if (!dev) redirect("/developers/login?next=/developers/console");

  const entry = A2A_AGENTS[DEFAULT_AGENT_KEY]!;
  const apps = (await listApps(dev.aid))
    .filter((a) => !a.revokedAt)
    .map((a) => ({ id: a.id, name: a.name, clientId: a.clientId, apiKeyHint: a.apiKeyHint, agentSlugs: a.agentSlugs }));

  return (
    <div className="flex flex-col gap-5" data-rise>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Console</h1>
          <p className="text-[13.5px] text-muted">
            {entry.name} · A2A 1.0 · <span className="mono">/a2a/{entry.key}</span>
          </p>
        </div>
        <p className="text-[13px] text-muted">
          Every call here is a real request to the doorway.{" "}
          <Link href="/developers/docs" className="text-brand hover:underline">
            Read the documentation
          </Link>
          .
        </p>
      </div>

      {apps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-surface px-6 py-10 text-center">
          <p className="text-[15px] font-medium text-ink">No application yet</p>
          <p className="mx-auto mt-1 max-w-[46ch] text-[13.5px] text-muted">
            The Console calls the agent as one of your applications. Create one first; its credentials are shown once, and the Console mints its own short-lived token so the secret never
            reaches the browser.
          </p>
          <Link
            href="/developers/apps"
            className="mt-5 inline-flex h-9 items-center rounded-lg bg-brand px-4 text-[13.5px] font-semibold text-white shadow-[var(--shadow-xs)] hover:bg-[color-mix(in_srgb,var(--color-brand)_90%,#000)]"
          >
            Go to Applications
          </Link>
        </div>
      ) : (
        <ConsoleClient
          apps={apps}
          agent={{ key: entry.key, name: entry.name, version: entry.version }}
          personas={entry.personas.map((p) => ({ id: p.id, label: p.label, description: p.description, signedIn: p.signedIn }))}
          identityExtension={CITIZEN_IDENTITY_EXTENSION}
          replyExtension={DIALOG_REPLY_EXTENSION}
        />
      )}
    </div>
  );
}
