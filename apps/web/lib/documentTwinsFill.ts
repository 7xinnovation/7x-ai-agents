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
import { acceptedDocTypes } from "./documentSlots";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * THE DATE TRAVELS WITH THE FILE.
 *
 * The first version copied the file and not its expiry. The CEP30 slot is
 * `validityRequired`, so it went on counting as outstanding: the model asked
 * for the licence again, the guard answered "already uploaded — nothing to do
 * here", and the applicant was then asked to type a date printed on the very
 * licence the case had read it from — `license_expiry_date: 2027-12-31` sat on
 * the case the whole time.
 *
 * The source document's own date first. Our `trade_license` slot is not
 * `validityRequired`, so it usually has none; for a licence twin the expiry the
 * extractor read off the licence is the same date, so that stands in.
 */
export function twinValidTo(
  sourceValidTo: string | undefined,
  to: string,
  slots: TwinSlot[],
  data: Record<string, unknown>
): string | undefined {
  if (sourceValidTo && ISO.test(sourceValidTo)) return sourceValidTo;
  const slot = slots.find((s) => s.key === to);
  const label = typeof slot?.label === "string" ? slot.label : String(slot?.label?.en ?? "");
  const isLicence = (acceptedDocTypes(to, label) ?? []).includes("trade_license");
  const read = String(data.license_expiry_date ?? "");
  return isLicence && ISO.test(read) ? read : undefined;
}

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
    const validTo = twinValidTo(fresh.state.documents.find((d) => d.key === from)?.validTo, to, slots, data);
    await getDb()
      .insert(documentsTable)
      .values({ caseId: fresh.caseId, key: to, status: "uploaded", fileName: row.fileName, storageKey: row.storageKey });
    state = await mutateCase(fresh.caseId, (st) =>
      setDocument(definition, st, {
        key: to,
        status: "uploaded",
        fileName: row.fileName ?? undefined,
        ...(validTo ? { validTo } : {}),
      })
    );
    held.add(to);
    filled.push({ from, to });
    await audit({
      agentId,
      conversationId,
      actor: "system",
      action: "document_twin_filled",
      payload: { from, to, fileName: row.fileName, validTo: validTo ?? null },
    }).catch(() => {});
  }
  return filled.length ? { state, filled } : null;
}
