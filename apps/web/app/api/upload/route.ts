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
import { getCase, mutateCase, audit } from "@/lib/conversation";
import { entityMismatch, expiredLicence, formatGulfDate, partnerDocumentCheck, partnerSlot, partnerIndexByName, ownerDocumentCheck, PARTNER_NAMES_KEY } from "@/lib/docIdentity";

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
  // Passport slots had NO rule, so any file at all satisfied one -- an Emirates
  // ID dropped into "Partner 2 — passport copy" was accepted without comment
  // while the reverse was correctly refused. After the Emirates ID test above,
  // so a slot naming both still means the card.
  if (/passport|جواز/.test(k)) return ["passport"];
  if (/trade|postal|licen[cs]e|approval|رخصة|موافقة/.test(k)) return ["trade_license", "initial_approval", "postal_license"];
  return null;
}

/** Case-data bookkeeping key: which fields each document's extraction filled. */
const DOC_FIELDS_KEY = "__doc_fields";
/** A company-name disagreement awaiting the customer's answer. */
const NAME_CONFLICT_KEY = "__name_conflict";
/** The fields that can hold a company name, for the audit line below. */
const NAME_FIELDS_FOR_AUDIT = ["company_name", "company_name_ar", "trade_name_en", "trade_name_ar"] as const;

/** Owner document slots, and the partner slot each one satisfies. */
const OWNER_TO_PARTNER: Record<string, string> = {
  emirates_id: "emirates_id",
  owner_emirates_id: "emirates_id",
  owner_passport: "passport",
  passport: "passport",
};

/**
 * One card, one upload — mirror an identity document between the owner slot and
 * the matching partner slot, in EITHER direction.
 *
 * The owner is very often also partner 1, and their Emirates ID is one card.
 * Asked for it as "the owner's" and then again as "Partner 1's", the customer
 * uploads the same file twice and is right to find that stupid.
 *
 * Both directions matter. Mirroring only owner → partner left the reverse case
 * untouched: upload partner 1's card first and the owner slot is still empty, so
 * it gets asked for anyway. Whichever arrives first now fills the other.
 *
 * Returns the updated case and which slot it filled, or null. Best-effort: a
 * failure here costs a duplicate upload request, so it must never fail the
 * upload itself.
 */
async function mirrorIdentityDoc(
  definition: Parameters<typeof setDocument>[0],
  caseId: string,
  key: string,
  fileName: string,
  extracted: Record<string, unknown>
): Promise<{ state: Awaited<ReturnType<typeof mutateCase>>; filled: string } | null> {
  try {
    const fresh = await getCase(caseId);
    const data = (fresh?.state.data ?? {}) as Record<string, unknown>;

    /**
     * Which partner is the owner?
     *
     * Worked out from the CASE first, not from the document. An Emirates ID card
     * often yields a number and no readable name -- the audit log shows
     * emirates_id uploads extracting owner_emirates_id and nothing else -- so a
     * mirror that waited for a name on the document never fired, and the
     * customer was asked for the same card twice.
     *
     * Three ways, cheapest first: the owner's name against the partner names on
     * the licence; the Emirates ID number the document DID yield; then the name,
     * if there was one.
     */
    const ownerIndex = (): number | null => {
      const ownerName = ["owner_name", "owner_name_ar"]
        .map((k) => data[k])
        .find((v): v is string => typeof v === "string" && v.trim().length > 1);
      if (ownerName) {
        const byName = partnerIndexByName(data, ownerName);
        if (byName) return byName;
      }
      const eid = String(extracted.owner_emirates_id ?? data.owner_emirates_id ?? "").replace(/\D/g, "");
      if (eid.length === 15) {
        for (let i = 1; i <= 12; i++) {
          if (String(data[`partner_${i}_emirates_id`] ?? "").replace(/\D/g, "") === eid) return i;
        }
      }
      const docName = ["owner_name", "owner_name_ar", "full_name", "name"]
        .map((k) => extracted[k])
        .find((v): v is string => typeof v === "string" && v.trim().length > 1);
      return docName ? partnerIndexByName(data, docName) : null;
    };

    let target: string | null = null;
    const ownerKind = OWNER_TO_PARTNER[key];
    if (ownerKind) {
      const index = ownerIndex();
      if (index) target = `partner_${index}_${ownerKind}`;
    } else {
      // A partner document, where that partner IS the owner, fills the owner slot.
      const slot = partnerSlot(key);
      if (slot && (slot.kind === "emirates_id" || slot.kind === "passport")) {
        if (ownerIndex() === slot.index) target = slot.kind === "emirates_id" ? "emirates_id" : "owner_passport";
      }
    }
    if (!target || target === key) return null;

    const already = fresh?.state.documents.find((d) => d.key === target);
    if (already && (already.status === "uploaded" || already.status === "accepted")) return null;
    const state = await mutateCase(caseId, (st) =>
      setDocument(definition, st, { key: target!, status: "uploaded", fileName })
    );
    return { state, filled: target };
  } catch {
    return null;
  }
}

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
    const state = await mutateCase(caseRow.caseId, (fresh) =>
      setDocument(agent.definition, fresh, {
        key,
        status: "rejected",
        fileName: file.name,
        rejectionReason: reason,
      })
    );
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
    const state = await mutateCase(caseRow.caseId, (fresh) =>
      setDocument(agent.definition, fresh, {
        key,
        status: "rejected",
        fileName: file.name,
        rejectionReason: mismatchReason,
      })
    );
    await audit({
      agentId: agent.id,
      conversationId,
      actor: "system",
      action: "document_rejected_wrong_type",
      payload: { key, fileName: file.name, classified: extraction.docType },
    });
    return NextResponse.json({ case: state, rejected: true, reason: mismatchReason });
  }

  // An identity document for somebody this licence does not name is REFUSED, not
  // remarked upon. A stranger's Emirates ID used to be accepted with a note that
  // the name did not seem to appear on the licence -- the card stayed on the
  // case, its number filled the owner's field, and the application carried
  // somebody else's identity into Salesforce.
  const ownerKind = OWNER_TO_PARTNER[key];
  if (ownerKind) {
    const verdict = ownerDocumentCheck(
      (caseRow.state.data ?? {}) as Record<string, unknown>,
      extraction.values ?? {},
      ownerKind === "passport" ? "passport" : "Emirates ID",
      { holderName: extraction.holderName }
    );
    if (verdict.reject) {
      const state = await mutateCase(caseRow.caseId, (fresh) =>
        setDocument(agent.definition, fresh, {
          key,
          status: "rejected",
          fileName: file.name,
          rejectionReason: verdict.reject!,
        })
      );
      await audit({
        agentId: agent.id,
        conversationId,
        actor: "system",
        action: "document_rejected_wrong_person",
        payload: { key, fileName: file.name },
      });
      return NextResponse.json({ case: state, rejected: true, reason: verdict.reject });
    }
  }

  // An EXPIRED trade licence stops the application. The client's rule, and the
  // right place for it is here: the licence copy is the evidence, so this is the
  // moment we can see the date rather than take it from the conversation. Refusing
  // at submission instead would be after the customer had done all the work.
  const stale = expiredLicence(extraction.values ?? {});
  if (stale) {
    const on = formatGulfDate(stale.expiredOn);
    const reason =
      sessionLocale === "ar"
        ? `الرخصة التجارية في هذا المستند منتهية الصلاحية بتاريخ ${on}. لا يمكن متابعة الطلب برخصة منتهية — يرجى تجديد الرخصة ورفع نسخة سارية.`
        : `The trade licence in this document expired on ${on}. An application cannot proceed on an expired licence — please renew it and upload a valid copy.`;
    const state = await mutateCase(caseRow.caseId, (fresh) =>
      setDocument(agent.definition, fresh, {
        key,
        status: "rejected",
        fileName: file.name,
        rejectionReason: reason,
      })
    );
    await audit({
      agentId: agent.id,
      conversationId,
      actor: "system",
      action: "document_rejected_expired_licence",
      payload: { key, fileName: file.name, expiredOn: on, field: stale.field },
    });
    return NextResponse.json({ case: state, rejected: true, reason });
  }

  // Cross-check against the entity already on the application: the right KIND of
  // document for the WRONG company must not be accepted either.
  const conflict = entityMismatch(caseRow.state.data ?? {}, extraction.values ?? {}, { documentKey: key });
  /**
   * WHAT THE CHECK DECIDED, AND WHAT IT HAD TO DECIDE IT ON.
   *
   * FB-1722 took three reproductions to explain because the only evidence a
   * document had been checked was the absence of a complaint. Recorded on every
   * upload now: the names we held, the names the document yielded, and the
   * verdict. A document that went through because it named nobody looks
   * completely different here from one that went through because it matched.
   */
  await audit({
    agentId: agent.id,
    conversationId,
    actor: "system",
    action: "document_entity_check",
    payload: {
      key,
      fileName: file.name,
      verdict: conflict?.severity ?? "clear",
      holderName: extraction.holderName ?? null,
      heldNames: NAME_FIELDS_FOR_AUDIT.map((f) => (caseRow.state.data ?? {})[f]).filter(Boolean).slice(0, 4),
      documentNames: NAME_FIELDS_FOR_AUDIT.map((f) => (extraction.values ?? {})[f]).filter(Boolean).slice(0, 4),
    },
  }).catch(() => {});
  if (conflict?.severity === "block") {
    const reason =
      sessionLocale === "ar"
        ? `بيانات هذا المستند لا تطابق الشركة المسجلة في هذا الطلب. يرجى رفع مستند الشركة نفسها، أو تصحيح البيانات أولاً.`
        : conflict.reason;
    const state = await mutateCase(caseRow.caseId, (fresh) =>
      setDocument(agent.definition, fresh, {
        key,
        status: "rejected",
        fileName: file.name,
        rejectionReason: reason,
      })
    );
    await audit({
      agentId: agent.id,
      conversationId,
      actor: "system",
      action: "document_rejected_entity_mismatch",
      payload: { key, fileName: file.name },
    });
    return NextResponse.json({ case: state, rejected: true, reason });
  }
  // Names disagree and nothing exact settles it. The document is KEPT -- a
  // registered name beside a trade name looks identical to a wrong company, and
  // refusing guessed wrong for a customer whose MOA was perfectly correct. The
  // question goes to the customer instead, and the extracted names are not
  // applied over what is already on file.
  // A partner's document is matched to a partner by the NAME on it, not by the
  // slot it was dropped into. A shuffled but complete set is worse than a short
  // one: every slot shows a tick and partner 3 has partner 1's passport.
  const partner = partnerDocumentCheck(key, caseRow.state.data ?? {}, extraction.values ?? {}, {
    holderName: extraction.holderName,
  });
  // A document that positively belongs to ANOTHER partner on this application is
  // refused outright. It used to be accepted with a note beneath it -- a green
  // tick against partner 1 with partner 3's card behind it -- and a tick reads as
  // done however carefully the note is worded.
  if (partner.conflict?.severity === "block") {
    const reason = partner.conflict.reason;
    const state = await mutateCase(caseRow.caseId, (fresh) =>
      setDocument(agent.definition, fresh, { key, status: "rejected", fileName: file.name, rejectionReason: reason })
    );
    await audit({
      agentId: agent.id,
      conversationId,
      actor: "system",
      action: "document_rejected_wrong_partner",
      payload: { key, fileName: file.name },
    });
    return NextResponse.json({ case: state, rejected: true, reason });
  }
  const nameQuery =
    partner.conflict?.reason ?? (conflict?.severity === "confirm" ? conflict.reason : null);
  if (nameQuery) {
    await audit({
      agentId: agent.id,
      conversationId,
      actor: "system",
      action: "document_name_needs_confirmation",
      payload: { key, fileName: file.name },
    });
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
    const state = await mutateCase(caseRow.caseId, (fresh) =>
      setDocument(agent.definition, fresh, {
        key,
        status: "rejected",
        fileName: file.name,
        rejectionReason: expiredReason,
      })
    );
    await audit({
      agentId: agent.id,
      conversationId,
      actor: "system",
      action: "document_rejected_expired",
      payload: { key, fileName: file.name, expiry: extraction.docExpiryDate },
    });
    return NextResponse.json({ case: state, rejected: true, reason: expiredReason });
  }

  // Everything from here runs against the FRESHEST case state, not the snapshot
  // read before extraction: a document uploaded in parallel finished while the
  // vision model was reading this one, and writing the stale snapshot back would
  // erase it.
  const extractedKeys: string[] = [];
  const state = await mutateCase(caseRow.caseId, (fresh) => {
    let next = setDocument(agent.definition, fresh, {
      key,
      status: "uploaded",
      fileName: file.name,
    });

    // Re-upload replaces its own data (FB-1442: values from an earlier file in
    // this slot must not survive a replacement — e.g. another company's license).
    // Fields filled by OTHER documents or typed by the customer are untouched.
    const docFields = { ...((next.data[DOC_FIELDS_KEY] as Record<string, string[]> | undefined) ?? {}) };
    const previouslyFilled = docFields[key] ?? [];
    if (previouslyFilled.length) {
      const cleared = { ...next.data };
      for (const fk of previouslyFilled) delete cleared[fk];
      next = recomputeReadiness(agent.definition, { ...next, data: cleared });
    }

    extractedKeys.length = 0;
    for (const [fieldKey, value] of Object.entries(extraction.values)) {
      // Do not overwrite a value the customer already provided.
      if (next.data[fieldKey] !== undefined && next.data[fieldKey] !== null && next.data[fieldKey] !== "") continue;
      const r = setField(agent.definition, next, fieldKey, value);
      if (!r.error) { next = r.state; extractedKeys.push(fieldKey); }
    }
    docFields[key] = extractedKeys;
    // A name disagreement the customer has to settle. Bookkeeping, not a field:
    // the "__" prefix keeps it out of the case panel and out of any submission.
    const data: Record<string, unknown> = { ...next.data, [DOC_FIELDS_KEY]: docFields };
    if (nameQuery) data[NAME_CONFLICT_KEY] = nameQuery;
    else delete data[NAME_CONFLICT_KEY];
    // Remember whose name this partner's documents carry, so the second document
    // of a pair can be matched against the first even when the licence named
    // nobody. Not recorded when the name is already disputed -- storing it would
    // make the misfiled document the reference for everything after it.
    const slot = partnerSlot(key);
    if (slot && partner.observedName && !partner.conflict) {
      const seen = { ...((data[PARTNER_NAMES_KEY] as Record<string, string> | undefined) ?? {}) };
      seen[String(slot.index)] = partner.observedName;
      data[PARTNER_NAMES_KEY] = seen;
    }
    return { ...next, data };
  });
  // The owner is usually also one of the partners, and their Emirates ID is ONE
  // card. Asked for it as "the owner's" and then again as "Partner 1's", the
  // customer uploads the same file twice -- which is what happened on the first
  // run through with partners. When the name on an owner document matches a
  // partner we already know about, that partner's slot is satisfied by the same
  // file rather than asked for again.
  const mirrored = await mirrorIdentityDoc(agent.definition, caseRow.caseId, key, file.name, extraction.values ?? {});

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

  return NextResponse.json({
    case: mirrored?.state ?? state,
    rejected: false,
    extracted: extractedKeys,
    needsConfirmation: nameQuery ?? undefined,
    // Named so the assistant can say it out loud rather than silently skipping a
    // slot the customer was expecting to fill.
    alsoFilled: mirrored?.filled,
  });
}
