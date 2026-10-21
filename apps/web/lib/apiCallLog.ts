/**
 * What the agents asked of somebody else's API, and what came back.
 *
 * Asked for on 21 October: an audit log on the admin of the endpoints being
 * called, which succeed and which fail, separately for each agent. Every
 * integration tool goes through `executeOperation`, so that is the only place
 * that writes here.
 *
 * TWO RULES, both of them about not making things worse:
 *
 *  1. A LOG MUST NEVER BREAK A RENTAL. The insert is fire-and-forget and its
 *     failure is swallowed. A customer paying for a PO Box is not going to lose
 *     the turn because our audit table is unreachable.
 *  2. NO CREDENTIALS, AND NO MORE PERSONAL DATA THAN THE PAGE NEEDS. Headers
 *     are never stored, so the Authorization bearer and the API key cannot be;
 *     a secret in a query string is masked; and both bodies go through the same
 *     redaction the guest responses use, whether or not the customer was
 *     identified. Someone debugging a 400 needs the shape of the payload, not
 *     the applicant's Emirates ID.
 */
import { getDb, apiCalls } from "@dialog/db";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { redactGuestPII } from "./pii";
import { log } from "./logger";

/** Bodies are for reading, not for archiving. */
const MAX_BODY = 4000;

/** Query parameters whose VALUE is a secret wherever it appears. */
const SECRET_PARAM = /^(.*(?:secret|password|passwd|pwd).*|.*api[_-]?key.*|.*access[_-]?token.*|token|code|signature|sig)$/i;

/**
 * The URL as it may be written down.
 *
 * Emirates Post takes a session token in the path on one operation and UAE PASS
 * answers its callback with `?code=`, so "it is only ever in a header" is not
 * true of this codebase. Masked by name, keeping the parameter so the shape of
 * the call is still legible.
 */
export function maskUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const [k] of [...u.searchParams]) if (SECRET_PARAM.test(k)) u.searchParams.set(k, "***");
    return u.toString();
  } catch {
    return raw;
  }
}

/** Redacted, then cut — so a long payload cannot carry PII past the truncation. */
export function forStorage(body: string | undefined | null): string | null {
  if (!body) return null;
  const clean = redactGuestPII(body);
  return clean.length > MAX_BODY ? `${clean.slice(0, MAX_BODY)}…(truncated)` : clean;
}

export interface ApiCallRecord {
  agentId?: string | null;
  conversationId?: string | null;
  integration?: string | null;
  environment?: string | null;
  tool?: string | null;
  method: string;
  path: string;
  url: string;
  status?: number | null;
  ok: boolean;
  durationMs: number;
  error?: string | null;
  requestBody?: string | null;
  responseBody?: string | null;
}

/** Write the row. Never throws, never awaited by the caller's happy path. */
export function recordApiCall(row: ApiCallRecord): void {
  void (async () => {
    try {
      await getDb()
        .insert(apiCalls)
        .values({
          agentId: row.agentId ?? null,
          conversationId: row.conversationId ?? null,
          integration: row.integration ?? null,
          environment: row.environment ?? null,
          tool: row.tool ?? null,
          method: row.method,
          path: row.path,
          url: maskUrl(row.url),
          status: row.status ?? null,
          ok: row.ok,
          durationMs: Math.max(0, Math.round(row.durationMs)),
          error: row.error ? row.error.slice(0, 500) : null,
          requestBody: forStorage(row.requestBody),
          responseBody: forStorage(row.responseBody),
        });
    } catch (e) {
      // Deliberately quiet: this is the one place where failing loudly would
      // make the product worse than the missing row does.
      log.warn("api_call_log_failed", { reason: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  })();
}

export type Outcome = "all" | "ok" | "error";

export interface ApiCallQuery {
  agentId?: string;
  outcome?: Outcome;
  /** Matches the path, the tool name or the bodies. */
  q?: string;
  /** Keyset pagination: rows strictly older than this. */
  before?: Date;
  limit?: number;
  /** Only the last N hours; omitted means everything kept. */
  hours?: number;
}

function where(f: ApiCallQuery): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  if (f.agentId) parts.push(eq(apiCalls.agentId, f.agentId));
  if (f.outcome === "ok") parts.push(eq(apiCalls.ok, true));
  if (f.outcome === "error") parts.push(eq(apiCalls.ok, false));
  if (f.before) parts.push(lt(apiCalls.createdAt, f.before));
  if (f.hours) parts.push(gte(apiCalls.createdAt, new Date(Date.now() - f.hours * 3_600_000)));
  if (f.q) {
    const like = `%${f.q.toLowerCase()}%`;
    parts.push(
      sql`(lower(${apiCalls.path}) like ${like} or lower(coalesce(${apiCalls.tool}, '')) like ${like} or lower(coalesce(${apiCalls.requestBody}, '')) like ${like} or lower(coalesce(${apiCalls.responseBody}, '')) like ${like})`
    );
  }
  const kept = parts.filter(Boolean) as SQL[];
  return kept.length ? and(...kept) : undefined;
}

export async function listApiCalls(f: ApiCallQuery) {
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 200);
  return getDb().select().from(apiCalls).where(where(f)).orderBy(desc(apiCalls.createdAt)).limit(limit);
}

/**
 * The three figures at the top of the page, counted over the same filter the
 * list uses — minus the outcome, because the whole point of the cards is the
 * split between the two.
 */
export async function apiCallStats(f: Omit<ApiCallQuery, "outcome" | "before" | "limit">) {
  const [row] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${apiCalls.ok} = false)::int`,
      avgMs: sql<number>`coalesce(round(avg(${apiCalls.durationMs})), 0)::int`,
    })
    .from(apiCalls)
    .where(where(f));
  return { total: row?.total ?? 0, errors: row?.errors ?? 0, avgMs: row?.avgMs ?? 0 };
}

/** Which endpoints are failing, worst first — the question the page exists to answer. */
export async function apiCallsByEndpoint(f: Omit<ApiCallQuery, "outcome" | "before" | "limit">) {
  return getDb()
    .select({
      method: apiCalls.method,
      path: apiCalls.path,
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${apiCalls.ok} = false)::int`,
      avgMs: sql<number>`coalesce(round(avg(${apiCalls.durationMs})), 0)::int`,
      lastAt: sql<string>`max(${apiCalls.createdAt})`,
    })
    .from(apiCalls)
    .where(where(f))
    .groupBy(apiCalls.method, apiCalls.path)
    .orderBy(sql`count(*) filter (where ${apiCalls.ok} = false) desc, count(*) desc`)
    .limit(100);
}

/**
 * Keep a month.
 *
 * At the volumes the portal screenshot shows — 83,000 calls — a table nobody
 * prunes becomes the biggest thing in the database and the slowest page in the
 * admin. A month covers "what broke last week" and every bug list we have
 * worked from.
 */
export async function pruneApiCalls(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const rows = await getDb().delete(apiCalls).where(lt(apiCalls.createdAt, cutoff)).returning({ id: apiCalls.id });
  return rows.length;
}
