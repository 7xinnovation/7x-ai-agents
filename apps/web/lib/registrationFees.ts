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
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";

/** bundleId → the fee Emirates Post charged for it, as last observed. */
export type FeeBook = Map<string, number>;

/**
 * `bundleId|years` → the RENT Emirates Post actually charged for that term.
 *
 * The duration cards were computed as the annual rate times the years, because
 * `Rental/Bundle` returns null for every multi-year field on the personal
 * bundles. It turns out the pricing engine has those prices anyway, and they are
 * DISCOUNTED — measured against real reservations on 6 Sep:
 *
 *   MyBox           1y 300   2y 600    5y 1200   (not 1500)
 *   MyHome          1y 695   3y 2085   10y 4000  (not 6950)
 *   MyHome Instant  1y 995   3y 2985   5y 4000   (not 4975)
 *
 * So the cards were overstating the longer terms — by AED 2,950 on a ten-year
 * MyHome — and the multi-year discount Emirates Post asked us to show was not
 * only missing, it was inverted. Corporate is unaffected: LI, BR and GO publish
 * their own 24/36/60/120-month prices and those match to the fils.
 *
 * Same mechanism as the fee: read back from reservations this deployment has
 * made, never computed, and absent rather than guessed.
 */
export type RentBook = Map<string, number>;

/** The key a rent observation is filed under. */
export const rentKey = (bundleId: string, years: number) => `${bundleId}|${years}`;

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; fees: FeeBook; rents: RentBook }>();

/**
 * Pull the `NEW-REG` amount out of one Select response.
 *
 * The audited body is truncated at 4000 characters, so a long price list can
 * arrive as invalid JSON. Parse it properly when it parses, and fall back to
 * reading the one line we need out of the text when it does not — a truncated
 * response still usually contains the whole `NEW-REG` object.
 */
/**
 * The RENT line and the term it was for, out of one Select response.
 *
 * The term comes from the response's own `poBoxExpiryDate` against the date the
 * reservation was made, so the observation is self-contained.
 */
export function rentInSelectResponse(response: string, madeAt: Date): RentBook {
  const out: RentBook = new Map();
  const body = response.slice(response.indexOf("\n") + 1);
  try {
    const parsed = JSON.parse(body) as Record<string, any>;
    const p = parsed?.payload ?? parsed;
    const details = p?.priceDetails;
    const expiry = p?.poBoxExpiryDate;
    if (!Array.isArray(details) || !expiry) return out;
    const t = new Date(String(expiry));
    if (Number.isNaN(t.getTime())) return out;
    const years = Math.round((t.getTime() - madeAt.getTime()) / (365.2425 * 24 * 60 * 60 * 1000));
    if (years < 1 || years > 20) return out;
    for (const d of details) {
      if (String(d?.serviceType ?? "").toUpperCase() !== "RENT") continue;
      const id = String(d?.bundleID ?? d?.bundleId ?? "").trim();
      const amount = Number(d?.totalAmount);
      if (id && Number.isFinite(amount) && amount > 0) out.set(rentKey(id, years), amount);
    }
  } catch {
    /* a truncated body simply teaches us nothing about rent */
  }
  return out;
}

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
  const rents = rentInSelectResponse(response, new Date());
  if (!fees.size && !rents.size) return;
  const key = scope(toolName);
  const cur = cache.get(key);
  const mergedFees = new Map(cur?.fees ?? []);
  for (const [k, v] of fees) mergedFees.set(k, v);
  const mergedRents = new Map(cur?.rents ?? []);
  for (const [k, v] of rents) mergedRents.set(k, v);
  cache.set(key, { at: cur?.at ?? Date.now(), fees: mergedFees, rents: mergedRents });
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
  return (await priceBook(agentId, selectToolName)).fees;
}

/** What each term of each bundle actually cost, as last observed. */
export async function observedRents(agentId: string, selectToolName: string): Promise<RentBook> {
  return (await priceBook(agentId, selectToolName)).rents;
}

async function priceBook(agentId: string, selectToolName: string): Promise<{ fees: FeeBook; rents: RentBook }> {
  const key = scope(selectToolName);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { fees: hit.fees, rents: hit.rents };
  const fees: FeeBook = new Map(hit?.fees ?? []);
  const rents: RentBook = new Map(hit?.rents ?? []);
  try {
    const rows = await getDb()
      .select({ payload: auditLog.payload, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.agentId, agentId),
          // `integration_write` is a Select the chat made. `registration_fee_observed`
          // is one made deliberately by scripts/nxn-observe-registration-fees, for a
          // bundle no customer has rented yet — same response, same backend, and
          // labelled so the two are never confused afterwards.
          inArray(auditLog.action, ["integration_write", "registration_fee_observed"]),
          gt(auditLog.createdAt, new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)),
          sql`${auditLog.payload}->>'tool' like ${key + "\\_\\_%"}`,
          // Either the fee was extracted when the row was written, or it is still
          // readable in the body. A long corporate response is truncated at 4000
          // characters and its NEW-REG line falls off the end, which is exactly
          // why the extracted copy exists.
          sql`(${auditLog.payload} ? 'fees' or ${auditLog.payload}->>'response' like '%NEW-REG%' or ${auditLog.payload}->>'response' like '%"RENT"%')`
        )
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(80);
    // Oldest first, so a newer row overwrites an older one for the same bundle.
    for (const r of rows.reverse()) {
      const p = r.payload as { response?: string; fees?: Record<string, unknown> } | null;
      if (!p) continue;
      // The extracted copy first: it was taken from the whole response, before
      // the audit truncated it.
      let took = false;
      for (const [b, v] of Object.entries(p.fees ?? {})) {
        const n = Number(v);
        if (b && Number.isFinite(n) && n > 0) { fees.set(b, n); took = true; }
      }
      if (!took && p.response) for (const [b, amt] of feesInSelectResponse(p.response)) fees.set(b, amt);
      // The rent is read from the response either way: it is never extracted at
      // write time, and the term it was for is inside the response itself.
      if (p.response) {
        const at = (r as { createdAt?: Date }).createdAt ?? new Date();
        for (const [k, amt] of rentInSelectResponse(p.response, at)) rents.set(k, amt);
      }
    }
  } catch {
    /* diagnostics for pricing must never take down pricing */
  }
  cache.set(key, { at: Date.now(), fees, rents });
  return { fees, rents };
}
