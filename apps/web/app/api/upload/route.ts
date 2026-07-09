import { NextRequest, NextResponse } from "next/server";
import { setDocument, setField, resolveAdapters, adapterContext, extractFieldsFromDocument } from "@dialog/core";
import { getDb, documents as documentsTable } from "@dialog/db";
import type { DocumentRequirement } from "@dialog/config";
import { getAgentBySlug } from "@/lib/agents";
import { ensureAdapters } from "@/lib/registry";
import { getCase, saveCase, audit } from "@/lib/conversation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Inline document upload (PRD: upload as an inline action with clear status).
 * Validates format/size against the journey's document matrix, stores via the
 * storage adapter, updates the case (uploaded/rejected with reason), persists,
 * and audits. Returns the updated case so the case-builder panel re-renders.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const agentSlug = String(form.get("agentSlug") ?? "");
  const conversationId = String(form.get("conversationId") ?? "");
  const key = String(form.get("key") ?? "");
  const file = form.get("file");

  if (!agentSlug || !conversationId || !key || !(file instanceof File)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const agent = await getAgentBySlug(agentSlug);
  if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 });

  const caseRow = await getCase(conversationId);
  if (!caseRow) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });

  // Locate the document requirement across the agent's journeys.
  let req_: DocumentRequirement | undefined;
  for (const j of agent.definition.journeys)
    for (const s of j.steps) {
      const found = s.documents.find((d) => d.key === key);
      if (found) req_ = found;
    }
  if (!req_) return NextResponse.json({ error: "unknown_document" }, { status: 400 });

  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const sizeMb = file.size / (1024 * 1024);

  // Validate, recording a rejection on the case if it fails (never a silent fail).
  let reason: string | null = null;
  if (!req_.acceptedFormats.map((f) => f.toLowerCase()).includes(ext)) {
    reason = `Unsupported format ".${ext}". Accepted: ${req_.acceptedFormats.join(", ").toUpperCase()}.`;
  } else if (sizeMb > req_.maxSizeMb) {
    reason = `File is ${sizeMb.toFixed(1)}MB, over the ${req_.maxSizeMb}MB limit.`;
  }

  ensureAdapters();
  const adapters = resolveAdapters(agent.definition);

  if (reason) {
    const state = setDocument(agent.definition, caseRow.state, {
      key,
      status: "rejected",
      fileName: file.name,
      rejectionReason: reason,
    });
    await saveCase(caseRow.caseId, state);
    return NextResponse.json({ case: state, rejected: true, reason });
  }

  // Read the bytes once — used for both storage and field extraction.
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Store via the configured storage adapter.
  let storageKey = `inline://${caseRow.caseId}/${key}/${file.name}`;
  if (adapters.storage) {
    const sctx = adapterContext(agent.definition, agent.definition.integrations.storage);
    const res = await adapters.storage.put(sctx, {
      caseId: caseRow.caseId,
      key,
      fileName: file.name,
      bytes,
      contentType: file.type || "application/octet-stream",
    });
    storageKey = res.storageKey;
  }

  let state = setDocument(agent.definition, caseRow.state, {
    key,
    status: "uploaded",
    fileName: file.name,
  });

  // Documents-first auto-fill: read the document with a vision model and
  // pre-fill whatever journey fields it contains, so the customer isn't asked
  // for details the document already carries. Best-effort — never blocks upload.
  const extractedKeys: string[] = [];
  try {
    const locale = (agent.definition.locales?.[0] ?? "en") as "en" | "ar";
    const { values } = await extractFieldsFromDocument({
      agent: agent.definition,
      state,
      locale,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      bytes,
    });
    for (const [fieldKey, value] of Object.entries(values)) {
      // Do not overwrite a value the customer already provided.
      if (state.data[fieldKey] !== undefined && state.data[fieldKey] !== null && state.data[fieldKey] !== "") continue;
      const r = setField(agent.definition, state, fieldKey, value);
      if (!r.error) { state = r.state; extractedKeys.push(fieldKey); }
    }
  } catch {
    /* extraction is best-effort; the upload still succeeds */
  }

  await saveCase(caseRow.caseId, state);
  await getDb()
    .insert(documentsTable)
    .values({ caseId: caseRow.caseId, key, status: "uploaded", fileName: file.name, storageKey });
  await audit({
    agentId: agent.id,
    conversationId,
    actor: "user",
    action: "document_uploaded",
    payload: { key, fileName: file.name, extracted: extractedKeys },
  });

  return NextResponse.json({ case: state, rejected: false, extracted: extractedKeys });
}
