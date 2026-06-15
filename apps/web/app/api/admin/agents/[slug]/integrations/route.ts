import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAgentBySlug } from "@/lib/agents";
import { parseSpec } from "@/lib/openapi";
import { listIntegrations, createIntegration, setIntegrationEnabled, deleteIntegration } from "@/lib/integrations";

export const runtime = "nodejs";
export const maxDuration = 60;

async function resolve(slug: string) {
  return getAgentBySlug(slug);
}

/** List integrations (auth secrets masked). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await resolve(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const rows = await listIntegrations(agent.id);
  return NextResponse.json({
    integrations: rows.map((r) => ({
      id: r.id, name: r.name, specUrl: r.specUrl, baseUrl: r.baseUrl,
      authType: r.authType, hasAuth: Boolean(r.authValue), enabled: r.enabled,
      operationCount: r.operations.length,
      operations: r.operations.map((o) => ({ toolName: o.toolName, method: o.method, path: o.path, summary: o.summary })),
    })),
  });
}

const ImportBody = z.object({
  specUrl: z.string().url(),
  baseUrl: z.string().url().optional(),
  authType: z.enum(["none", "bearer", "apiKey"]).default("none"),
  authValue: z.string().optional(),
  authHeader: z.string().optional(),
  name: z.string().optional(),
});

/** Import an OpenAPI/Swagger spec and register its operations as tools. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await resolve(slug);
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

  const row = await createIntegration(agent.id, {
    name: b.name || spec.title,
    specUrl: b.specUrl,
    baseUrl: spec.baseUrl,
    authType: b.authType,
    authValue: b.authValue ?? null,
    authHeader: b.authHeader ?? null,
    operations: spec.operations,
  });
  return NextResponse.json({ ok: true, id: row!.id, name: b.name || spec.title, baseUrl: spec.baseUrl, operationCount: spec.operations.length });
}

const PatchBody = z.object({ id: z.string(), enabled: z.boolean() });
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await resolve(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await setIntegrationEnabled(agent.id, parsed.data.id, parsed.data.enabled);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await resolve(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await deleteIntegration(agent.id, id);
  return NextResponse.json({ ok: true });
}
