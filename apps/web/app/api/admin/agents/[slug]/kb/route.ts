import { NextRequest, NextResponse } from "next/server";
import { denyAgent } from "@/lib/scope";
import { z } from "zod";
import { transcribeDocumentToText, KB_IMPORT_EXTENSIONS } from "@dialog/core";
import { getAgentBySlug } from "@/lib/agents";
import { createKbDocument, listKbDocuments, deleteKbDocument, setKbStatus } from "@/lib/kb";

export const runtime = "nodejs";
// Transcribing a long PDF through the model can take a while.
export const maxDuration = 300;

const MAX_IMPORT_MB = 20;

/** Why an import failed, in words an admin can act on (FB-1508). */
const IMPORT_ERRORS: Record<string, string> = {
  unsupported_word_document:
    "Word documents can't be read directly. Please export it as a PDF and import that.",
  unsupported_file_type: `Unsupported file type. Import one of: ${KB_IMPORT_EXTENSIONS.join(", ")}.`,
  no_text_found: "No readable text was found in that file.",
  empty_file: "That file is empty.",
};

/** List the agent's knowledge-base documents. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
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
  status: z.enum(["draft", "published", "archived"]).default("published"),
});

/**
 * Add a knowledge-base document (chunked + embedded when a provider is set).
 *
 * Two shapes:
 *  - JSON  : { title, source, locale, content } — pasted text, as before.
 *  - multipart/form-data : an imported FILE (FB-1508). PDFs, images and text
 *    files are transcribed to plain text first, then ingested identically, so
 *    imported content is chunked, embedded and cited exactly like pasted text.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "missing_file" }, { status: 400 });
    if (file.size > MAX_IMPORT_MB * 1024 * 1024) {
      return NextResponse.json({ error: `File is over the ${MAX_IMPORT_MB}MB limit.` }, { status: 413 });
    }
    const locale = form.get("locale") === "ar" ? "ar" : "en";
    const status = form.get("status") === "draft" ? "draft" : "published";
    // Default the title/source to the file name so an import needs no typing.
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const title = String(form.get("title") ?? "").trim() || baseName;
    const source = String(form.get("source") ?? "").trim() || file.name;

    const { text, error } = await transcribeDocumentToText({
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    if (error || !text) {
      return NextResponse.json(
        { error: IMPORT_ERRORS[error ?? ""] ?? "That file could not be read." },
        { status: 422 }
      );
    }
    const result = await createKbDocument({ agentId: agent.id, title, source, locale, content: text, status });
    return NextResponse.json({ ok: true, title, characters: text.length, ...result });
  }

  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const result = await createKbDocument({ agentId: agent.id, ...parsed.data });
  return NextResponse.json({ ok: true, ...result });
}

const PatchBody = z.object({ id: z.string(), status: z.enum(["draft", "published", "archived"]) });

/** Change a document's publishing status. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await setKbStatus(agent.id, parsed.data.id, parsed.data.status);
  return NextResponse.json({ ok: true });
}

/** Delete a knowledge-base document by id (?id=). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const denied = await denyAgent(slug);
  if (denied) return denied;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await deleteKbDocument(agent.id, id);
  return NextResponse.json({ ok: true });
}
