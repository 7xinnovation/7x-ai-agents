import { NextRequest, NextResponse } from "next/server";
import { getAgentBySlug } from "@/lib/agents";

export const runtime = "nodejs";

/**
 * Public agent config consumed by the embed app. Integration bindings (and any
 * secret refs) are stripped — the client only needs presentation + journey shape
 * to render the chat and the case builder.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ agent: string }> }) {
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
    intents: d.intents.map((i) => ({ key: i.key, description: i.description })),
    journeys: d.journeys.map((j) => ({
      key: j.key,
      title: j.title,
      summary: j.summary,
      steps: j.steps.map((s) => ({
        key: s.key,
        title: s.title,
        fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.validation.required })),
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
  });
}
