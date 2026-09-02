import { registerMockAdapters, registerAdapter, embeddingsEnabled, embedQuery, registerSalesforceAdapter, registerNgeniusAdapter, registerUaePassAdapter } from "@dialog/core";
import type { CRMAdapter, KBAdapter, KBResult, StorageAdapter } from "@dialog/core";
import { getDb, kbChunks, kbDocuments, documentBlobs, cases, conversations } from "@dialog/db";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { sendEmail } from "./email";
import { raiseEpCase } from "./epCase";
import { log } from "./logger";

let initialised = false;

/**
 * Register all adapter providers once per server process. Mock providers let the
 * platform run end-to-end; real providers are credential-activated and selected
 * per agent via integrations.<cap>.provider — binding to "salesforce" / "ngenius"
 * / "uaepass" switches that capability from mock to the real vendor with zero
 * code change. Knowledge is always backed by Neon (pgvector) so grounding is real.
 */
export function ensureAdapters() {
  if (initialised) return;
  registerMockAdapters();
  // Real vendor adapters (used only when an agent's integration binds to them).
  registerSalesforceAdapter();
  registerNgeniusAdapter();
  registerUaePassAdapter();

  // Neon-backed KB: keyword retrieval over kb_chunks (pgvector-ready). Until an
  // embeddings provider is wired, rank by term-overlap via full-text matching.
  const neonKb: KBAdapter = {
    async search(_ctx, input): Promise<KBResult[]> {
      const db = getDb();
      const limit = input.limit ?? 4;
      // Only retrieve chunks whose parent document is published (PRD lifecycle).
      const publishedDocs = db
        .select({ id: kbDocuments.id })
        .from(kbDocuments)
        .where(eq(kbDocuments.status, "published"));

      // Vector search when an embeddings provider is configured (pgvector cosine).
      if (embeddingsEnabled()) {
        try {
          const qvec = await embedQuery(input.query);
          if (qvec) {
            const lit = `[${qvec.join(",")}]`;
            const rows = await db
              .select({
                content: kbChunks.content,
                source: sql<string>`coalesce(${kbChunks.metadata} ->> 'source', 'knowledge-base')`,
                score: sql<number>`1 - (${kbChunks.embedding} <=> ${lit}::vector)`,
              })
              .from(kbChunks)
              .where(
                and(
                  eq(kbChunks.agentId, input.agentId),
                  sql`${kbChunks.embedding} is not null`,
                  inArray(kbChunks.documentId, publishedDocs)
                )
              )
              .orderBy(sql`${kbChunks.embedding} <=> ${lit}::vector`)
              .limit(limit);
            if (rows.length) return rows.map((r) => ({ content: r.content, source: r.source, score: Number(r.score) }));
          }
        } catch {
          // fall through to full-text on any embedding/query error
        }
      }

      // English gets stemming; Arabic falls back to 'simple' (no AR stemmer by default).
      const cfg = input.locale === "ar" ? "simple" : "english";
      // OR-match significant terms (>=3 chars), so a natural-language question
      // retrieves passages instead of requiring every word (plainto = AND).
      const terms = (input.query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 12);
      if (!terms.length) return [];
      const orQuery = terms.join(" | ");
      const tsv = sql`to_tsvector(${cfg}, ${kbChunks.content})`;
      const tsq = sql`to_tsquery(${cfg}, ${orQuery})`;
      const rows = await db
        .select({
          content: kbChunks.content,
          source: sql<string>`coalesce(${kbChunks.metadata} ->> 'source', 'knowledge-base')`,
          score: sql<number>`ts_rank(${tsv}, ${tsq})`,
        })
        .from(kbChunks)
        .where(and(eq(kbChunks.agentId, input.agentId), sql`${tsv} @@ ${tsq}`, inArray(kbChunks.documentId, publishedDocs)))
        .orderBy(sql`ts_rank(${tsv}, ${tsq}) DESC`)
        .limit(input.limit ?? 4);
      return rows.map((r) => ({ content: r.content, source: r.source, score: Number(r.score) }));
    },
  };
  registerAdapter("knowledge", "neon", () => neonKb);

  /**
   * Durable document storage in Postgres.
   *
   * The only storage provider registered before this was "mock", which keeps the
   * bytes in a 200-entry in-process Map. Uploads survived until the next restart,
   * eviction or scale event — and submission reads them back to attach to
   * Salesforce, so an application could be filed without the trade licence it was
   * approved on. There is an audit action for it (sf_document_skipped /
   * bytes_unavailable), which is the shape of a failure someone expected.
   *
   * put() upserts on storageKey so re-uploading the same document key replaces the
   * bytes rather than accumulating orphans; get() returns null for anything not
   * found, which the submission path already treats as "skip and audit" rather
   * than an error.
   */
  const pgStorage: StorageAdapter = {
    async put(_ctx, input) {
      const storageKey = `pg://${input.caseId}/${input.key}/${input.fileName}`;
      const bytes = Buffer.from(input.bytes);
      await getDb()
        .insert(documentBlobs)
        .values({
          storageKey,
          caseId: input.caseId,
          contentType: input.contentType || "application/octet-stream",
          sizeBytes: bytes.length,
          bytes,
        })
        .onConflictDoUpdate({
          target: documentBlobs.storageKey,
          set: { bytes, contentType: input.contentType || "application/octet-stream", sizeBytes: bytes.length },
        });
      return { storageKey };
    },
    async get(_ctx, input) {
      const [row] = await getDb()
        .select({ bytes: documentBlobs.bytes, contentType: documentBlobs.contentType })
        .from(documentBlobs)
        .where(eq(documentBlobs.storageKey, input.storageKey))
        .limit(1);
      if (!row) return null;
      return { bytes: new Uint8Array(row.bytes), contentType: row.contentType };
    },
  };
  registerAdapter("storage", "postgres", () => pgStorage);

  /**
   * A CRM that answers from what we actually know, for tenants with no CRM.
   *
   * The mock it replaces was not a stub that failed — it was a stub that
   * SUCCEEDED, confidently, with invented data: any status question returned
   * "Under Review"; a callback request returned a reference and reached nobody;
   * renewal prefill offered "Demo Trading LLC", PO Box 50500, licence CN-1234567.
   * In production those are wrong answers delivered with a straight face, which is
   * worse than an error the customer can act on.
   *
   * Nothing here invents anything. Status comes from this customer's own cases in
   * our database. Callbacks and manual requests are emailed to the branch ops
   * mailbox, so a person genuinely receives them. Prefill returns nothing at all,
   * because we hold no system-of-record data to prefill from — the renewal
   * journeys read the real values from Emirates Post instead.
   */
  const opsCrm: CRMAdapter = {
    async createCase(_ctx, input) {
      // Journeys that submit to Emirates Post use apiFlow.saveTool and never reach
      // here. What is left is the manage-an-existing-box flow, which a human
      // actions — so the reference has to correspond to a message someone gets.
      const reference = `NXN-${randomUUID().slice(0, 8).toUpperCase()}`;
      const to = process.env.NXN_BRANCH_OPS_EMAIL?.trim();
      if (!to) throw new Error("No ops mailbox configured (NXN_BRANCH_OPS_EMAIL) — cannot record this request");
      const res = await sendEmail({
        to,
        subject: `[${reference}] ${input.journeyKey} request from the assistant`,
        text: `Reference: ${reference}\nJourney: ${input.journeyKey}\nCustomer: ${input.userRef ?? "guest"}\n\n${JSON.stringify(input.data, null, 2)}`,
      });
      // A reference for a request nobody received is the mock's failure mode.
      if (!res.ok) throw new Error(`Could not send this request to the branch team (${res.reason})`);
      return { reference };
    },

    async getStatus(_ctx, input) {
      if (!input.userRef && !input.reference) return null;
      const db = getDb();
      const rows = await db
        .select({ state: cases.state, updatedAt: cases.updatedAt })
        .from(cases)
        .innerJoin(conversations, eq(conversations.id, cases.conversationId))
        .where(input.reference ? sql`${cases.state} ->> 'reference' = ${input.reference}` : eq(conversations.userRef, input.userRef))
        .orderBy(desc(cases.updatedAt))
        .limit(1);
      const state = rows[0]?.state as { status?: string; reference?: string; readiness?: { missing?: string[] } } | undefined;
      if (!state) return null;
      const missing = state.readiness?.missing ?? [];
      const status =
        state.status === "submitted"
          ? `Submitted${state.reference ? ` (reference ${state.reference})` : ""}`
          : state.status === "escalated"
            ? "With the team"
            : missing.length
              ? "In progress — not yet submitted"
              : "Ready to submit";
      return {
        status,
        missing,
        nextSteps:
          state.status === "submitted"
            ? ["The team will be in touch about this request."]
            : missing.length
              ? ["Finish the outstanding items and submit."]
              : ["Confirm the details to submit."],
      };
    },

    async createCallback(_ctx, input) {
      // A callback belongs in the queue Emirates Post's team already works, not
      // in a mailbox of ours: their contact form raises a case on /nextApi/case
      // and hands the customer a case number they can quote. Try that first.
      const [firstName, ...rest] = String(input.name ?? "").trim().split(/\s+/);
      const epCase = await raiseEpCase({
        firstName: firstName || "Customer",
        lastName: rest.join(" ") || "-",
        mobile: String(input.phone ?? ""),
        email: input.email,
        message: String(input.reason ?? ""),
      }).catch((e) => ({ ok: false as const, reason: "unreachable" as const, detail: String(e) }));

      if (epCase.ok) return { reference: epCase.caseNumber };

      // Their endpoint is CAPTCHA-gated and a server cannot mint the token, so
      // this is the expected path today. Losing the callback would be worse than
      // routing it the old way, so it still goes to the ops mailbox -- with the
      // reason recorded, because "the callback went somewhere else" should not be
      // something anyone has to guess at later.
      log.warn("ep_case_fallback_to_email", { reason: epCase.reason, detail: epCase.detail });
      const reference = `CB-${randomUUID().slice(0, 8).toUpperCase()}`;
      const to = process.env.NXN_BRANCH_OPS_EMAIL?.trim();
      if (!to) throw new Error("No ops mailbox configured (NXN_BRANCH_OPS_EMAIL) — cannot arrange a callback");
      const res = await sendEmail({
        to,
        subject: `[${reference}] Callback requested via the assistant`,
        text:
          `Reference: ${reference}\nName: ${input.name}\nPhone: ${input.phone}\nEmail: ${input.email ?? "-"}\n` +
          `Customer: ${input.userRef ?? "guest"}\n\nReason:\n${input.reason}\n\n` +
          `(Not raised on emiratespost.ae: ${epCase.reason} — ${epCase.detail})`,
      });
      if (!res.ok) throw new Error(`Could not pass the callback to the team (${res.reason})`);
      return { reference };
    },

    async findDuplicate() {
      // We hold no system of record to check against, and a confident "no
      // duplicate" is a claim we cannot support. Null means "unknown", which the
      // caller already treats as "carry on".
      return null;
    },

    async getRecord() {
      // Never prefill from data we do not have. The mock's canned company details
      // would otherwise appear in a real customer's renewal.
      return null;
    },
  };
  registerAdapter("crm", "ops", () => opsCrm);

  initialised = true;
}
