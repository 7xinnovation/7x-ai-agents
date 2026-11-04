/**
 * Fill catalogue twins on the case itself — at upload, and again every turn.
 *
 * `catalogueTwinOf` decides; this writes. Two places call it because one was not
 * enough: at the upload the product is usually not chosen yet, so the twin
 * cannot be decided, and it becomes decidable on a later turn when nothing is
 * being uploaded. Idempotent: a twin already holding a file is never touched.
 *
 * The twin gets a `documents` ROW with the source's storageKey, not only a tick
 * in the case state: `epglDocumentRows` finds a file by looking its slot up in
 * that table, so a state-only twin would show green and never reach EPGL.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb, documents as documentsTable } from "@dialog/db";
import { setDocument, type CaseState } from "@dialog/core";
import { getCase, mutateCase, audit } from "./conversation";
import { catalogueTwinOf, type TwinSlot } from "./documentTwins";

type Definition = Parameters<typeof setDocument>[0];

export async function fillCatalogueTwins(
  definition: Definition,
  /** A CONVERSATION id — `getCase` is keyed on the conversation, not the case. */
  conversationId: string,
  agentId?: string
): Promise<{ state: CaseState; filled: { from: string; to: string }[] } | null> {
  const fresh = await getCase(conversationId);
  if (!fresh) return null;
  const journey = (definition as { journeys: { key: string; steps: { documents?: TwinSlot[] }[] }[] }).journeys.find(
    (j) => j.key === fresh.state.journeyKey
  );
  const slots = (journey?.steps ?? []).flatMap((st) => st.documents ?? []);
  if (!slots.some((s) => s.salesforceType)) return null; // no catalogue slots, no twins

  const held = new Set(
    fresh.state.documents.filter((d) => d.status === "uploaded" || d.status === "accepted").map((d) => d.key)
  );
  const data = (fresh.state.data ?? {}) as Record<string, unknown>;
  const filled: { from: string; to: string }[] = [];
  let state = fresh.state;

  for (const from of [...held]) {
    const to = catalogueTwinOf(slots, from, data, (k) => held.has(k));
    if (!to) continue;
    const [row] = await getDb()
      .select({ fileName: documentsTable.fileName, storageKey: documentsTable.storageKey })
      .from(documentsTable)
      .where(and(eq(documentsTable.caseId, fresh.caseId), eq(documentsTable.key, from)))
      .orderBy(desc(documentsTable.createdAt))
      .limit(1);
    if (!row?.storageKey) continue;
    await getDb()
      .insert(documentsTable)
      .values({ caseId: fresh.caseId, key: to, status: "uploaded", fileName: row.fileName, storageKey: row.storageKey });
    state = await mutateCase(fresh.caseId, (st) =>
      setDocument(definition, st, { key: to, status: "uploaded", fileName: row.fileName ?? undefined })
    );
    held.add(to);
    filled.push({ from, to });
    await audit({
      agentId,
      conversationId,
      actor: "system",
      action: "document_twin_filled",
      payload: { from, to, fileName: row.fileName },
    }).catch(() => {});
  }
  return filled.length ? { state, filled } : null;
}
