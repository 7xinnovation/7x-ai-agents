import { NextRequest, NextResponse } from "next/server";
import { getAgentBySlug } from "@/lib/agents";

export const runtime = "nodejs";

/**
 * Public agent config consumed by the embed app. Integration bindings (and any
 * secret refs) are stripped — the client only needs presentation + journey shape
 * to render the chat and the case builder.
 */
/**
 * The embed loader calls this from the HOST page, not from our own origin, so the
 * response needs CORS or the browser drops it -- and it did: the launcher lost its
 * brand colour and every host console showed a blocked-by-CORS error that reads like
 * the widget is broken when it is only the theme lookup that failed.
 *
 * Echoed per request rather than "*", and only for an origin the agent already names
 * in allowedOrigins, so this exposes nothing the agent has not already agreed to be
 * embedded by. An agent with no allowedOrigins gets no CORS at all.
 */
function corsHeaders(req: NextRequest, allowedOrigins: string[]): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const permitted = allowedOrigins.some((o) => {
    try {
      return new URL(o).origin === origin;
    } catch {
      return false;
    }
  });
  if (!permitted) return {};
  // Vary matters: without it a cache could serve one host's allow-header to another.
  return { "access-control-allow-origin": origin, "vary": "Origin" };
}

/** Preflight. A plain GET does not trigger one, but a caller adding a header would. */
export async function OPTIONS(req: NextRequest, { params }: { params: Promise<{ agent: string }> }) {
  const { agent: slug } = await params;
  const agent = await getAgentBySlug(slug);
  const headers = agent ? corsHeaders(req, agent.definition.allowedOrigins ?? []) : {};
  return new NextResponse(null, {
    status: 204,
    headers: { ...headers, "access-control-allow-methods": "GET, OPTIONS", "access-control-max-age": "86400" },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ agent: string }> }) {
  const { agent: slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 });

  const d = agent.definition;
  return NextResponse.json({
    slug: d.slug,
    name: d.name,
    locales: d.locales,
    allowedOrigins: d.allowedOrigins,
    greeting: d.greeting,
    theme: d.theme,
    documentsDisclaimer: d.documentsDisclaimer,
    documentsInChat: d.documentsInChat,
    uploadsPerMessage: d.uploadsPerMessage,
    intents: d.intents.map((i) => ({ key: i.key, description: i.description })),
    journeys: d.journeys.map((j) => ({
      key: j.key,
      title: j.title,
      summary: j.summary,
      steps: j.steps.map((s) => ({
        key: s.key,
        title: s.title,
        fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.validation.required, condition: f.condition, editable: f.editable })),
        documents: s.documents.map((doc) => ({
          key: doc.key,
          label: doc.label,
          requirement: doc.requirement,
          condition: doc.condition,
          acceptedFormats: doc.acceptedFormats,
          maxSizeMb: doc.maxSizeMb,
        })),
      })),
    })),
  }, { headers: corsHeaders(req, d.allowedOrigins ?? []) });
}
