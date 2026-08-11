import { NextRequest, NextResponse } from "next/server";
import {
  setDocument,
  setField,
  recomputeReadiness,
  resolveAdapters,
  adapterContext,
  extractFieldsFromDocument,
  DOC_TYPE_LABELS,
  type DocType,
} from "@dialog/core";
import { getDb, documents as documentsTable, conversations } from "@dialog/db";
import { eq } from "drizzle-orm";
import type { DocumentRequirement } from "@dialog/config";
import { getAgentBySlug } from "@/lib/agents";
import { ensureAdapters } from "@/lib/registry";
import { getCase, saveCase, audit } from "@/lib/conversation";

/**
 * Which classified document types are acceptable for a given document slot,
 * inferred from the slot's key + label. Returns null when the slot doesn't map
 * to a known official-document family — then no type gate applies (so agents
 * with custom document kinds are never wrongly blocked).
 */
function acceptedDocTypes(key: string, label: string): DocType[] | null {
  const k = `${key} ${label}`.toLowerCase();
  if (/emirates.?id|eid|هوية/.test(k)) return ["emirates_id"];
  if (/moa|memorandum|تأسيس/.test(k)) return ["moa"];
  // The specific revenue documents come BEFORE the generic financial/licence
  // tests: a Form 9 slot must not fall through to "financial_statement", and a
  // Form 9 must never satisfy a licence slot (renewal-round feedback).
  if (/form.?0?9|نموذج.?9/.test(k)) return ["form_9"];
  if (/audited|afs|مدقق/.test(k)) return ["audited_financial_statement", "financial_statement"];
  if (/acknowledg|إقرار.?استلام|خطاب/.test(k)) return ["acknowledgement_letter"];
  if (/financial|statement|مالي/.test(k)) return ["financial_statement", "audited_financial_statement"];
  if (/declaration|undertaking|commitment|تعهد/.test(k)) return ["declaration"];
  if (/trade|postal|licen[cs]e|approval|رخصة|موافقة/.test(k)) return ["trade_license", "initial_approval", "postal_license"];
  return null;
}

/**
 * Cross-check an uploaded document against what the application already holds
 * (renewal-round feedback: "cross-reference uploaded files against registered
 * entity data before acceptance" — a mismatched company's trade licence was
 * being accepted).
 *
 * Only identifiers we can compare unambiguously are checked, and only when BOTH
 * sides are present: the first document of a journey has nothing to contradict.
 * Returns a customer-facing reason, or null when nothing conflicts.
 */
const IDENTITY_CHECKS: { key: string; label: string; normalize: (s: string) => string }[] = [
  { key: "trade_license_number", label: "trade licence number", normalize: (s) => s.replace(/[^0-9a-z]/gi, "").toLowerCase() },
  { key: "postal_license_number", label: "postal licence number", normalize: (s) => s.replace(/[^0-9a-z]/gi, "").toLowerCase() },
  { key: "company_name", label: "company name", normalize: (s) => s.replace(/\b(llc|l\.l\.c|fze|fzc|est|establishment|company|co|trading|general)\b/gi, "").replace(/[^a-z0-9]/gi, "").toLowerCase() },
];

function entityMismatch(
  existing: Record<string, unknown>,
  extracted: Record<string, unknown>
): string | null {
  for (const check of IDENTITY_CHECKS) {
    const before = existing[check.key];
    const after = extracted[check.key];
    if (typeof before !== "string" || typeof after !== "string") continue;
    const a = check.normalize(before);
    const b = check.normalize(after);
    if (!a || !b || a === b) continue;
    // Substring either way covers an abbreviated vs full legal name.
    if (a.includes(b) || b.includes(a)) continue;
    return (
      `This document's ${check.label} (${after}) does not match the one already on this application (${before}). ` +
      `Please upload the document for the same company, or correct the details first.`
    );
  }
  return null;
}

/** Case-data bookkeeping key: which fields each document's extraction filled. */
const DOC_FIELDS_KEY = "__doc_fields";

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

  // Documents-first auto-fill: read the document with a vision model BEFORE
  // recording it, so an expired identity document can be rejected up front and
  // journey fields can be pre-filled from a valid one. Best-effort — extraction
  // failure never blocks the upload itself.
  const sessionLocale = ((await getDb().query.conversations.findFirst({ where: eq(conversations.id, conversationId) }))?.locale ?? agent.definition.locales?.[0] ?? "en") as "en" | "ar";
  const reqLabel = typeof req_.label === "string" ? req_.label : (req_.label[sessionLocale] ?? req_.label.en ?? key);
  let extraction: Awaited<ReturnType<typeof extractFieldsFromDocument>> = { values: {} };
  try {
    extraction = await extractFieldsFromDocument({
      agent: agent.definition,
      state: caseRow.state,
      locale: sessionLocale,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      bytes,
      expected: { key, label: reqLabel },
    });
  } catch {
    /* extraction is best-effort */
  }

  // Document TYPE validation (Round-1-internal FB-1443/1449/1451/1452/1455):
  // when the slot maps to a known document family and the vision model
  // confidently classified the file as something else (another official doc, a
  // business card, or an unrecognised file), REJECT the upload with a clear
  // reason and apply none of its data. Classification failures (no docType) are
  // not rejected — extraction stays best-effort and the review team backstops.
  const accepted = acceptedDocTypes(key, reqLabel);
  if (accepted && extraction.docType && !accepted.includes(extraction.docType)) {
    const typeLabel = DOC_TYPE_LABELS[extraction.docType][sessionLocale];
    const mismatchReason =
      sessionLocale === "ar"
        ? `الملف المرفوع يبدو أنه ${typeLabel} وليس "${reqLabel}". يرجى رفع المستند الصحيح.`
        : `This file looks like a ${typeLabel}, not the requested "${reqLabel}". Please upload the correct document.`;
    const state = setDocument(agent.definition, caseRow.state, {
      key,
      status: "rejected",
      fileName: file.name,
      rejectionReason: mismatchReason,
    });
    await saveCase(caseRow.caseId, state);
    await audit({
      agentId: agent.id,
      conversationId,
      actor: "system",
      action: "document_rejected_wrong_type",
      payload: { key, fileName: file.name, classified: extraction.docType },
    });
    return NextResponse.json({ case: state, rejected: true, reason: mismatchReason });
  }

  // Cross-check against the entity already on the application: the right KIND of
  // document for the WRONG company must not be accepted either.
  const conflict = entityMismatch(caseRow.state.data ?? {}, extraction.values ?? {});
  if (conflict) {
    const reason =
      sessionLocale === "ar"
        ? `بيانات هذا المستند لا تطابق الشركة المسجلة في هذا الطلب. يرجى رفع مستند الشركة نفسها، أو تصحيح البيانات أولاً.`
        : conflict;
    const state = setDocument(agent.definition, caseRow.state, {
      key,
      status: "rejected",
      fileName: file.name,
      rejectionReason: reason,
    });
    await saveCase(caseRow.caseId, state);
    await audit({
      agentId: agent.id,
      conversationId,
      actor: "system",
      action: "document_rejected_entity_mismatch",
      payload: { key, fileName: file.name },
    });
    return NextResponse.json({ case: state, rejected: true, reason });
  }

  // Feedback (Round 2): detect an expired Emirates ID and request a valid one
  // before proceeding — an identity document whose printed expiry is in the past
  // is rejected, its fields are NOT applied, and the agent asks for a valid card.
  const isIdentityDoc = key === "emirates_id" || key.endsWith("_emirates_id");
  const today = new Date().toISOString().slice(0, 10);
  if (isIdentityDoc && extraction.docExpiryDate && extraction.docExpiryDate < today) {
    const expiredReason =
      sessionLocale === "ar"
        ? `الهوية الإماراتية منتهية الصلاحية (انتهت في ${extraction.docExpiryDate}). يرجى رفع هوية سارية المفعول.`
        : `This Emirates ID is expired (expiry date ${extraction.docExpiryDate}). Please upload a valid, unexpired Emirates ID.`;
    const state = setDocument(agent.definition, caseRow.state, {
      key,
      status: "rejected",
      fileName: file.name,
      rejectionReason: expiredReason,
    });
    await saveCase(caseRow.caseId, state);
    await audit({
      agentId: agent.id,
      conversationId,
      actor: "system",
      action: "document_rejected_expired",
      payload: { key, fileName: file.name, expiry: extraction.docExpiryDate },
    });
    return NextResponse.json({ case: state, rejected: true, reason: expiredReason });
  }

  let state = setDocument(agent.definition, caseRow.state, {
    key,
    status: "uploaded",
    fileName: file.name,
  });

  // Re-upload replaces its own data (FB-1442: values from an earlier file in
  // this slot must not survive a replacement — e.g. another company's license).
  // Fields filled by OTHER documents or typed by the customer are untouched.
  const docFields = { ...((state.data[DOC_FIELDS_KEY] as Record<string, string[]> | undefined) ?? {}) };
  const previouslyFilled = docFields[key] ?? [];
  if (previouslyFilled.length) {
    const cleared = { ...state.data };
    for (const fk of previouslyFilled) delete cleared[fk];
    state = recomputeReadiness(agent.definition, { ...state, data: cleared });
  }

  const extractedKeys: string[] = [];
  for (const [fieldKey, value] of Object.entries(extraction.values)) {
    // Do not overwrite a value the customer already provided.
    if (state.data[fieldKey] !== undefined && state.data[fieldKey] !== null && state.data[fieldKey] !== "") continue;
    const r = setField(agent.definition, state, fieldKey, value);
    if (!r.error) { state = r.state; extractedKeys.push(fieldKey); }
  }
  docFields[key] = extractedKeys;
  state = { ...state, data: { ...state.data, [DOC_FIELDS_KEY]: docFields } };

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
