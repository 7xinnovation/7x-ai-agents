/**
 * The one-time registration fee, with its amount, on the bundle card.
 *
 * Emirates Post asked three times for the figure to appear under the price, and
 * three times it could not: `Rental/Bundle` returns the annual rental alone, and
 * there is no endpoint that prices the fee. It exists in exactly one place — the
 * `NEW-REG` line of the `priceDetails` a successful `Rental/Select` returns —
 * and Select happens four steps AFTER the card the customer reads.
 *
 * So the figure is not invented and it is not hard-coded: it is READ BACK from
 * the Selects this deployment has already made. Every Select is audited with its
 * full response (it is a write), so the last one for a bundle states that
 * bundle's registration fee, in that environment, from Emirates Post's own
 * numbers. A bundle nobody has rented yet has no figure and keeps the wording it
 * has now — which is the honest answer, and it corrects itself the moment one
 * rental goes through.
 *
 * Scoped by TOOL NAME, so the staging integration's fees can never be quoted on
 * production: the two are separate integrations with separate prefixes.
 */
import { getDb, auditLog } from "@dialog/db";
import { and, desc, eq, gt, sql } from "drizzle-orm";

/** bundleId → the fee Emirates Post charged for it, as last observed. */
export type FeeBook = Map<string, number>;

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; fees: FeeBook }>();

/**
 * Pull the `NEW-REG` amount out of one Select response.
 *
 * The audited body is truncated at 4000 characters, so a long price list can
 * arrive as invalid JSON. Parse it properly when it parses, and fall back to
 * reading the one line we need out of the text when it does not — a truncated
 * response still usually contains the whole `NEW-REG` object.
 */
export function feesInSelectResponse(response: string): FeeBook {
  const out: FeeBook = new Map();
  const body = response.slice(response.indexOf("\n") + 1);
  const take = (bundleId: unknown, amount: unknown) => {
    const id = String(bundleId ?? "").trim();
    const n = Number(amount);
    if (id && Number.isFinite(n) && n > 0 && !out.has(id)) out.set(id, n);
  };
  try {
    const parsed = JSON.parse(body) as Record<string, any>;
    const details = parsed?.payload?.priceDetails ?? parsed?.priceDetails;
    if (Array.isArray(details)) {
      for (const d of details) if (String(d?.serviceType ?? "") === "NEW-REG") take(d?.bundleID ?? d?.bundleId, d?.totalAmount);
      if (out.size) return out;
    }
  } catch {
    /* truncated body — fall through to the textual read */
  }
  // `[^{]` deliberately: it stops the match walking into priceDetailItems, whose
  // own objects also carry an `amount`.
  const re = /\{\s*"bundleID"\s*:\s*"([^"]+)"[^{]*?"serviceType"\s*:\s*"NEW-REG"[^{]*?"totalAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
  for (const m of body.matchAll(re)) take(m[1], m[2]);
  return out;
}

/** Remember a fee we have just seen, so it is on the card without a round trip. */
export function rememberFees(toolName: string, response: string) {
  const fees = feesInSelectResponse(response);
  if (!fees.size) return;
  const key = scope(toolName);
  const cur = cache.get(key);
  const merged = new Map(cur?.fees ?? []);
  for (const [k, v] of fees) merged.set(k, v);
  cache.set(key, { at: cur?.at ?? Date.now(), fees: merged });
}

/** Integration prefix — everything before the `__` in a tool name. */
function scope(toolName: string): string {
  const i = toolName.indexOf("__");
  return i === -1 ? toolName : toolName.slice(0, i);
}

/**
 * Registration fees observed for this integration, newest first.
 *
 * Never throws: a database that will not answer means the cards keep the wording
 * they have today, which is exactly what they said before this existed.
 */
export async function registrationFees(agentId: string, selectToolName: string): Promise<FeeBook> {
  const key = scope(selectToolName);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.fees;
  const fees: FeeBook = new Map(hit?.fees ?? []);
  try {
    const rows = await getDb()
      .select({ payload: auditLog.payload })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.agentId, agentId),
          eq(auditLog.action, "integration_write"),
          gt(auditLog.createdAt, new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)),
          sql`${auditLog.payload}->>'tool' like ${key + "\\_\\_%"}`,
          sql`${auditLog.payload}->>'response' like '%NEW-REG%'`
        )
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(80);
    // Oldest first, so a newer row overwrites an older one for the same bundle.
    for (const r of rows.reverse()) {
      const p = r.payload as { response?: string } | null;
      if (!p?.response) continue;
      for (const [b, amt] of feesInSelectResponse(p.response)) fees.set(b, amt);
    }
  } catch {
    /* diagnostics for pricing must never take down pricing */
  }
  cache.set(key, { at: Date.now(), fees });
  return fees;
}
