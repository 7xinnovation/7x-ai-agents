import { and, desc, eq, not, or } from "drizzle-orm";
import { getDb, blockedCompanies, blockedCompanyBatches } from "@dialog/db";
import { readSheet } from "./sheet";

/**
 * The companies Licensing will not renew.
 *
 * EPGL's renewal process map, shared 15 September, puts this immediately after
 * the company lookup: "System will check if company is blacklisted?" — yes, and
 * the client is told the renewal cannot proceed and that the Licensing team
 * will contact them.
 *
 * The list belongs to Licensing, not to us. It changes, it arrives as a
 * spreadsheet, and it must be replaceable by whoever is on shift without a
 * deploy — so it is uploaded in the admin panel and read here.
 *
 * WHAT THE AGENT IS ALLOWED TO SAY ABOUT IT. The reason column is Licensing's
 * internal note and is never shown to a customer: "unable to proceed, the
 * Licensing team will contact you" is the whole of the customer-facing message,
 * which is what their own process map specifies. Telling an applicant they are
 * on a blacklist, and why, is not ours to do.
 *
 * AND AN EMPTY LIST BLOCKS NOBODY. If no list has been uploaded, or the upload
 * failed, every company passes. The failure mode of a missing list must be that
 * renewals continue, never that every renewal stops.
 */

/** Upper case, alphanumeric only — "697-670", " 697670 " and "697670" are one. */
export function blockKey(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Company names collapse further: legal-form suffixes differ between sources. */
const NAME_NOISE = /\b(L\.?L\.?C|F\.?Z\.?E|F\.?Z\.?C|FZ|EST|ESTABLISHMENT|COMPANY|CO|BRANCH|SOLE|PROPRIETORSHIP)\b/g;
export function nameKey(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(NAME_NOISE, "").replace(/[^A-Z0-9]/g, "");
}

export interface BlockedMatch {
  /** Which value matched: what a support ticket needs to see. */
  matchedOn: "trade licence number" | "postal licence number" | "company name";
  companyName?: string | null;
  tradeLicenseNumber?: string | null;
  postalLicenseNumber?: string | null;
  /** Licensing's internal note. NEVER shown to the customer. */
  reason?: string | null;
}

/**
 * Is this company on the list?
 *
 * Any of the three identifiers is enough, and they are checked in order of how
 * much they prove: a licence number is an identifier, a name is a spelling.
 * Nothing supplied means nothing matched — an unidentified company is not a
 * blocked one.
 */
export async function findBlocked(
  agentId: string,
  who: { tradeLicenseNumber?: unknown; postalLicenseNumber?: unknown; companyName?: unknown }
): Promise<BlockedMatch | null> {
  const trade = blockKey(who.tradeLicenseNumber);
  const postal = blockKey(who.postalLicenseNumber);
  const name = nameKey(who.companyName);
  if (!trade && !postal && !name) return null;

  const clauses = [
    trade ? eq(blockedCompanies.tradeLicenseKey, trade) : null,
    postal ? eq(blockedCompanies.postalLicenseKey, postal) : null,
    // A name alone is weak evidence, so it is only allowed to match when it is
    // long enough to be a name rather than an initialism.
    name.length >= 6 ? eq(blockedCompanies.companyNameKey, name) : null,
  ].filter(Boolean);
  if (!clauses.length) return null;

  const rows = await getDb()
    .select()
    .from(blockedCompanies)
    .where(and(eq(blockedCompanies.agentId, agentId), or(...(clauses as never[]))))
    .limit(5);
  if (!rows.length) return null;

  const pick =
    (trade && rows.find((r) => r.tradeLicenseKey === trade)) ||
    (postal && rows.find((r) => r.postalLicenseKey === postal)) ||
    rows[0]!;
  const row = pick as (typeof rows)[number];
  return {
    matchedOn:
      trade && row.tradeLicenseKey === trade
        ? "trade licence number"
        : postal && row.postalLicenseKey === postal
          ? "postal licence number"
          : "company name",
    companyName: row.companyName,
    tradeLicenseNumber: row.tradeLicenseNumber,
    postalLicenseNumber: row.postalLicenseNumber,
    reason: row.reason,
  };
}

/* ------------------------------ uploads ---------------------------------- */

/** Header names we accept for each column, matched loosely. */
const COLUMNS: { field: "trade" | "postal" | "name" | "reason"; match: RegExp }[] = [
  { field: "trade", match: /^(trade|commercial|ded)?\s*(licen[cs]e|licence|license)?\s*(no|nos|number|num|#)?$/i },
  { field: "postal", match: /postal/i },
  { field: "name", match: /(company|entity|establishment|trade)\s*name|^name$|^company$/i },
  { field: "reason", match: /reason|remark|note|comment|status/i },
];

function columnMap(headers: string[]): Record<"trade" | "postal" | "name" | "reason", number> {
  const at = { trade: -1, postal: -1, name: -1, reason: -1 };
  headers.forEach((h, i) => {
    const header = h.trim();
    if (!header) return;
    if (at.postal === -1 && /postal/i.test(header)) { at.postal = i; return; }
    if (at.trade === -1 && /(trade|commercial|ded).*licen|licen.*(no|number|#)|^tl$/i.test(header)) { at.trade = i; return; }
    if (at.name === -1 && /name|company|entity/i.test(header)) { at.name = i; return; }
    if (at.reason === -1 && /reason|remark|note|comment/i.test(header)) { at.reason = i; return; }
  });
  return at;
}

export interface UploadResult {
  batchId: string;
  fileName: string;
  rowCount: number;
  skippedCount: number;
  /** What each column was taken to mean, so the operator can see we read it right. */
  columns: { trade?: string; postal?: string; name?: string; reason?: string };
}

/**
 * Replace the whole list from one uploaded file.
 *
 * REPLACE, not merge. A list of who may not renew is only meaningful as a
 * whole: merging two uploads means a company Licensing REMOVED from the list
 * stays blocked forever, and nobody would find out until an applicant
 * complained. So the new batch lands first and the old rows go after it, inside
 * one transaction — at no point is the list empty, and a failure leaves the
 * previous list exactly as it was.
 */
export async function replaceBlocklist(
  agentId: string,
  fileName: string,
  bytes: Buffer,
  uploadedBy?: string
): Promise<UploadResult> {
  const sheet = readSheet(fileName, bytes);
  if (!sheet.headers.length) throw new Error("That file has no rows in it.");
  const at = columnMap(sheet.headers);
  if (at.trade === -1 && at.postal === -1 && at.name === -1) {
    throw new Error(
      `No usable column found. The file needs a column headed something like "Trade License Number", ` +
        `"Postal License Number" or "Company Name". This file has: ${sheet.headers.filter(Boolean).join(", ")}`
    );
  }

  const cell = (row: string[], i: number) => (i === -1 ? "" : (row[i] ?? "").trim());
  const seen = new Set<string>();
  const values: (typeof blockedCompanies.$inferInsert)[] = [];
  let skipped = 0;
  const batchId = crypto.randomUUID();

  for (const row of sheet.rows) {
    const tradeLicenseNumber = cell(row, at.trade);
    const postalLicenseNumber = cell(row, at.postal);
    const companyName = cell(row, at.name);
    const tradeLicenseKey = blockKey(tradeLicenseNumber);
    const postalLicenseKey = blockKey(postalLicenseNumber);
    const companyNameKey = nameKey(companyName);
    if (!tradeLicenseKey && !postalLicenseKey && !companyNameKey) { skipped++; continue; }
    // The same company twice in one file is one row, not two.
    const dedupe = `${tradeLicenseKey}|${postalLicenseKey}|${companyNameKey}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    values.push({
      agentId,
      batchId,
      tradeLicenseKey: tradeLicenseKey || null,
      postalLicenseKey: postalLicenseKey || null,
      companyNameKey: companyNameKey || null,
      tradeLicenseNumber: tradeLicenseNumber || null,
      postalLicenseNumber: postalLicenseNumber || null,
      companyName: companyName || null,
      reason: cell(row, at.reason) || null,
    });
  }
  if (!values.length) throw new Error("That file names no companies — every row was empty.");

  const db = getDb();
  await db.transaction(async (tx) => {
    for (let i = 0; i < values.length; i += 500) await tx.insert(blockedCompanies).values(values.slice(i, i + 500));
    await tx
      .delete(blockedCompanies)
      .where(and(eq(blockedCompanies.agentId, agentId), not(eq(blockedCompanies.batchId, batchId))));
    await tx.delete(blockedCompanyBatches).where(eq(blockedCompanyBatches.agentId, agentId));
    await tx.insert(blockedCompanyBatches).values({
      id: batchId,
      agentId,
      fileName,
      rowCount: values.length,
      skippedCount: skipped,
      uploadedBy: uploadedBy ?? null,
    });
  });

  const name = (i: number) => (i === -1 ? undefined : sheet.headers[i]);
  return {
    batchId,
    fileName,
    rowCount: values.length,
    skippedCount: skipped,
    columns: { trade: name(at.trade), postal: name(at.postal), name: name(at.name), reason: name(at.reason) },
  };
}

/** The list as it stands: the batch, and the first rows of it. */
export async function blocklistSummary(agentId: string, sample = 25) {
  const db = getDb();
  const [batch] = await db
    .select()
    .from(blockedCompanyBatches)
    .where(eq(blockedCompanyBatches.agentId, agentId))
    .orderBy(desc(blockedCompanyBatches.createdAt))
    .limit(1);
  const rows = await db
    .select({
      id: blockedCompanies.id,
      companyName: blockedCompanies.companyName,
      tradeLicenseNumber: blockedCompanies.tradeLicenseNumber,
      postalLicenseNumber: blockedCompanies.postalLicenseNumber,
      reason: blockedCompanies.reason,
    })
    .from(blockedCompanies)
    .where(eq(blockedCompanies.agentId, agentId))
    .limit(sample);
  return { batch: batch ?? null, rows };
}

/** Remove the list entirely — nobody is blocked after this. */
export async function clearBlocklist(agentId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(blockedCompanies).where(eq(blockedCompanies.agentId, agentId));
    await tx.delete(blockedCompanyBatches).where(eq(blockedCompanyBatches.agentId, agentId));
  });
}
