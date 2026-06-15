import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAgentBySlug } from "@/lib/agents";
import { createKbDocument, listKbDocuments, deleteKbDocument } from "@/lib/kb";

export const runtime = "nodejs";

/** List the agent's knowledge-base documents. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const docs = await listKbDocuments(agent.id);
  return NextResponse.json({ docs, embeddings: Boolean(process.env.VOYAGE_API_KEY) });
}

const CreateBody = z.object({
  title: z.string().min(1),
  source: z.string().default(""),
  locale: z.enum(["en", "ar"]).default("en"),
  content: z.string().min(1),
});

/** Add a knowledge-base document (chunked + embedded when a provider is set). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const result = await createKbDocument({ agentId: agent.id, ...parsed.data });
  return NextResponse.json({ ok: true, ...result });
}

/** Delete a knowledge-base document by id (?id=). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await deleteKbDocument(agent.id, id);
  return NextResponse.json({ ok: true });
}
