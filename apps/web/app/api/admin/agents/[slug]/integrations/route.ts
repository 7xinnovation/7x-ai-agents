import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { denyAgent } from "@/lib/scope";
import { z } from "zod";
import { getAgentBySlug } from "@/lib/agents";
import { parseSpec } from "@/lib/openapi";
import { verifySession } from "@/lib/session";
import { audit } from "@/lib/conversation";
import { listIntegrations, upsertEnvironment, setIntegrationEnabled, deleteIntegration, deleteEnvironment } from "@/lib/integrations";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * WHO CHANGED AN INTEGRATION, AND WHAT THEY CHANGED.
 *
 * Nothing here was audited, and on 8 September that cost a day. Rental/Select
 * was enabled:false in production, so the model was never handed the
 * reservation tool, no hold could exist, and every PO Box rental was refused at
 * the payment step. The last successful reservation was 6 September at 19:06
 * and the flag was off by the 8th -- and there was no way to tell what had
 * turned it off, or when, or who by, because the one config change that can
 * silently take a payment journey offline left no trace at all.
 *
 * Every mutation on this route now writes an audit row. Reads do not.
 */
async function whoami(): Promise<string> {
  try {
    const claims = await verifySession((await cookies()).get("dlg_admin")?.value);
    return claims?.email ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Which operations an environment has turned OFF, by tool name. */
function disabledTools(ops: { toolName?: string; enabled?: boolean }[] | undefined): string[] {
  return (ops ?? []).filter((o) => o.enabled === false).map((o) => String(o.toolName ?? "")).filter(Boolean).sort();
}

/** List integrations with per-environment detail (auth secrets masked). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const rows = await listIntegrations(agent.id);
  return NextResponse.json({
    activeEnvironment: agent.definition.activeEnvironment ?? "production",
    integrations: rows.map((r) => ({
      id: r.id, name: r.name, enabled: r.enabled,
      environments: Object.fromEntries(
        (["staging", "production"] as const)
          .filter((e) => r.environments[e])
          .map((e) => {
            const s = r.environments[e]!;
            return [e, { specUrl: s.specUrl, baseUrl: s.baseUrl, authType: s.authType, hasAuth: Boolean(s.authValue), hasApiKey: Boolean(s.apiKey), apiKeyHeader: s.apiKeyHeader ?? null, operationCount: s.operations.length, operations: s.operations.map((o) => ({ toolName: o.toolName, method: o.method, path: o.path, summary: o.summary })) }];
          })
      ),
    })),
  });
}

const ImportBody = z.object({
  name: z.string().min(1),
  environment: z.enum(["staging", "production"]),
  specUrl: z.string().url(),
  baseUrl: z.string().url().optional(),
  authType: z.enum(["none", "bearer", "apiKey", "uaepass_test", "uaepass_live"]).default("none"),
  authValue: z.string().optional(),
  authHeader: z.string().optional(),
  // Gateway/app key sent on every request (independent of per-user session auth).
  apiKey: z.string().optional(),
  apiKeyHeader: z.string().optional(),
});

/** Import an OpenAPI/Swagger spec into one environment of an integration. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = ImportBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  let spec;
  try {
    spec = await parseSpec(b.specUrl, b.baseUrl);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "parse_failed" }, { status: 422 });
  }
  if (!spec.operations.length) return NextResponse.json({ error: "No operations found in spec." }, { status: 422 });
  if (!spec.baseUrl) return NextResponse.json({ error: "Could not determine base URL — provide one." }, { status: 422 });

  // An import REPLACES the environment's operation list outright, so every
  // per-operation enabled flag set by hand is discarded and silently replaced by
  // whatever the spec parser produces. That is the single most consequential
  // thing anyone can do from this screen, so what it displaced is recorded.
  const prevEnv = (await listIntegrations(agent.id)).find((i) => i.name.toLowerCase() === b.name.toLowerCase())?.environments?.[b.environment];
  const wasDisabled = disabledTools(prevEnv?.operations);
  const nowDisabled = disabledTools(spec.operations);

  await upsertEnvironment(agent.id, b.name, b.environment, {
    specUrl: b.specUrl,
    baseUrl: spec.baseUrl,
    authType: b.authType,
    authValue: b.authValue ?? null,
    authHeader: b.authHeader ?? null,
    apiKey: b.apiKey ?? null,
    apiKeyHeader: b.apiKeyHeader ?? null,
    operations: spec.operations,
  });

  await audit({
    agentId: agent.id,
    actor: "user",
    action: prevEnv ? "integration_spec_reimported" : "integration_imported",
    payload: {
      by: await whoami(),
      integration: b.name,
      environment: b.environment,
      specUrl: b.specUrl,
      baseUrl: spec.baseUrl,
      operationCount: spec.operations.length,
      previousOperationCount: prevEnv?.operations?.length ?? 0,
      // The flags this import moved, named rather than counted -- a count tells
      // nobody that the reservation tool is the one that just came back on.
      wasDisabled,
      nowDisabled,
      reEnabled: wasDisabled.filter((t) => !nowDisabled.includes(t)),
      newlyDisabled: nowDisabled.filter((t) => !wasDisabled.includes(t)),
      removedTools: (prevEnv?.operations ?? [])
        .map((o) => String(o.toolName ?? ""))
        .filter((t) => t && !spec.operations.some((o) => o.toolName === t))
        .sort(),
    },
  });
  return NextResponse.json({ ok: true, name: b.name, environment: b.environment, baseUrl: spec.baseUrl, operationCount: spec.operations.length });
}

const PatchBody = z.object({ id: z.string(), enabled: z.boolean() });
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // Read the previous value BEFORE writing, so the row says what changed rather
  // than only what it is now.
  const before = (await listIntegrations(agent.id)).find((i) => i.id === parsed.data.id);
  await setIntegrationEnabled(agent.id, parsed.data.id, parsed.data.enabled);
  await audit({
    agentId: agent.id,
    actor: "user",
    action: parsed.data.enabled ? "integration_enabled" : "integration_disabled",
    payload: {
      by: await whoami(),
      integration: before?.name ?? parsed.data.id,
      integrationId: parsed.data.id,
      was: before?.enabled ?? null,
      now: parsed.data.enabled,
    },
  });
  return NextResponse.json({ ok: true });
}

/** Delete a whole integration (?id=) or a single environment (?id=&env=). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const id = req.nextUrl.searchParams.get("id");
  const env = req.nextUrl.searchParams.get("env");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const doomed = (await listIntegrations(agent.id)).find((i) => i.id === id);
  if (env === "staging" || env === "production") await deleteEnvironment(agent.id, id, env);
  else await deleteIntegration(agent.id, id);
  await audit({
    agentId: agent.id,
    actor: "user",
    action: env === "staging" || env === "production" ? "integration_environment_deleted" : "integration_deleted",
    payload: {
      by: await whoami(),
      integration: doomed?.name ?? id,
      integrationId: id,
      environment: env ?? null,
      // What the agent has just lost the ability to call.
      operationCount: (env === "staging" || env === "production" ? doomed?.environments?.[env]?.operations?.length : undefined) ?? null,
    },
  });
  return NextResponse.json({ ok: true });
}
