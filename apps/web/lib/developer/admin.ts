/**
 * What a portal admin can see and change (2026-10-15): every developer
 * account and its applications, every call and task on the doorway, the audit
 * trail, and the portal settings. Every change an admin makes is written to the
 * audit log under `developer_admin_*`, with who made it.
 */
import { and, desc, eq, gt, ilike, inArray, like, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, developerAccounts, developerApps, a2aRequests, a2aTasks, auditLog, agents } from "@dialog/db";
import { audit } from "@/lib/conversation";
import { A2A_AGENTS } from "@/lib/a2a/catalogue";
import { publicApp } from "./accounts";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function adminAudit(by: string, action: string, payload: Record<string, unknown>): Promise<void> {
  await audit({ actor: "system", action: `developer_admin_${action}`, payload: { by: `developer:${by}`, ...payload } }).catch(() => {});
}

// ─── Overview ────────────────────────────────────────────────────────────────

export async function adminOverview() {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [acc] = await db
    .select({ total: sql<number>`count(*)`, active: sql<number>`count(*) filter (where ${developerAccounts.active})`, admins: sql<number>`count(*) filter (where ${developerAccounts.role} = 'admin')` })
    .from(developerAccounts);
  const [apps] = await db
    .select({ total: sql<number>`count(*)`, live: sql<number>`count(*) filter (where ${developerApps.revokedAt} is null)` })
    .from(developerApps);
  const [req] = await db
    .select({ n: sql<number>`count(*)`, errors: sql<number>`count(*) filter (where not ${a2aRequests.ok})`, p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${a2aRequests.latencyMs}), 0)` })
    .from(a2aRequests)
    .where(gt(a2aRequests.createdAt, since));
  const [tasks] = await db
    .select({
      n: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where ${a2aTasks.state} = 'TASK_STATE_COMPLETED')`,
      open: sql<number>`count(*) filter (where ${a2aTasks.state} in ('TASK_STATE_WORKING','TASK_STATE_INPUT_REQUIRED','TASK_STATE_AUTH_REQUIRED','TASK_STATE_SUBMITTED'))`,
    })
    .from(a2aTasks);
  const signIns = await db
    .select({ n: sql<number>`count(*)` })
    .from(auditLog)
    .where(and(eq(auditLog.action, "developer_signed_in"), gt(auditLog.createdAt, since)));
  const n = (v: unknown) => Number(v ?? 0);
  return {
    accounts: { total: n(acc?.total), active: n(acc?.active), admins: n(acc?.admins) },
    applications: { total: n(apps?.total), live: n(apps?.live) },
    requests24h: { total: n(req?.n), errors: n(req?.errors), medianLatencyMs: Math.round(n(req?.p50)) },
    tasks: { total: n(tasks?.n), completed: n(tasks?.completed), open: n(tasks?.open) },
    signIns24h: n(signIns[0]?.n),
  };
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function listAccounts() {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db.select().from(developerAccounts).orderBy(desc(developerAccounts.createdAt));
  const appCounts = await db
    .select({ accountId: developerApps.accountId, total: sql<number>`count(*)`, live: sql<number>`count(*) filter (where ${developerApps.revokedAt} is null)` })
    .from(developerApps)
    .groupBy(developerApps.accountId);
  const reqCounts = await db
    .select({ accountId: developerApps.accountId, n: sql<number>`count(*)` })
    .from(a2aRequests)
    .innerJoin(developerApps, eq(a2aRequests.appId, developerApps.id))
    .where(gt(a2aRequests.createdAt, since))
    .groupBy(developerApps.accountId);
  const apps = new Map(appCounts.map((r) => [r.accountId, r]));
  const reqs = new Map(reqCounts.map((r) => [r.accountId, Number(r.n)]));
  return rows.map((r) => ({
    id: r.id,
    organization: r.organization,
    name: r.name,
    email: r.email,
    role: r.role === "admin" ? "admin" : "developer",
    active: r.active,
    lastLoginAt: iso(r.lastLoginAt),
    createdAt: r.createdAt.toISOString(),
    invitedBy: r.invitedBy,
    applications: Number(apps.get(r.id)?.total ?? 0),
    liveApplications: Number(apps.get(r.id)?.live ?? 0),
    requests24h: reqs.get(r.id) ?? 0,
  }));
}

export async function createAccount(input: { organization: string; name: string; email: string; role: "developer" | "admin" }, by: string) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await getDb().select({ id: developerAccounts.id }).from(developerAccounts).where(eq(developerAccounts.email, email)).limit(1);
  if (existing) return { error: "exists" as const };
  const [row] = await getDb()
    .insert(developerAccounts)
    .values({ organization: input.organization.trim(), name: input.name.trim(), email, role: input.role, active: true, invitedBy: `developer:${by}` })
    .returning();
  await adminAudit(by, "account_created", { accountId: row!.id, email, organization: row!.organization, role: input.role });
  return { account: row! };
}

export async function updateAccount(
  id: string,
  patch: { organization?: string; name?: string; role?: "developer" | "admin"; active?: boolean },
  by: { aid: string; email: string }
) {
  if (id === by.aid && (patch.active === false || patch.role === "developer")) return { error: "self_lockout" as const };
  const db = getDb();
  const [before] = await db.select().from(developerAccounts).where(eq(developerAccounts.id, id)).limit(1);
  if (!before) return { error: "not_found" as const };
  // Never leave the portal without an active admin.
  if (before.role === "admin" && (patch.role === "developer" || patch.active === false)) {
    const counted = await db
      .select({ n: sql<number>`count(*)` })
      .from(developerAccounts)
      .where(and(eq(developerAccounts.role, "admin"), eq(developerAccounts.active, true)));
    if (Number(counted[0]?.n ?? 0) <= 1) return { error: "last_admin" as const };
  }
  const set: Partial<typeof developerAccounts.$inferInsert> = {};
  if (patch.organization !== undefined) set.organization = patch.organization.trim();
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.active !== undefined) {
    set.active = patch.active;
    // A deactivated account cannot finish a sign-in it had started.
    if (!patch.active) Object.assign(set, { otpHash: null, otpExpiresAt: null });
  }
  const [row] = await db.update(developerAccounts).set(set).where(eq(developerAccounts.id, id)).returning();
  const changes = Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => v !== undefined && (before as Record<string, unknown>)[k === "organization" ? "organization" : k] !== v)
  );
  await adminAudit(by.email, "account_updated", { accountId: id, email: before.email, changes });
  return { account: row! };
}

// ─── Applications ────────────────────────────────────────────────────────────

export async function listAllApps() {
  const rows = await getDb()
    .select({ app: developerApps, email: developerAccounts.email, organization: developerAccounts.organization })
    .from(developerApps)
    .innerJoin(developerAccounts, eq(developerApps.accountId, developerAccounts.id))
    .orderBy(desc(developerApps.createdAt));
  return rows.map((r) => ({ ...publicApp(r.app), accountId: r.app.accountId, accountEmail: r.email, organization: r.organization }));
}

export async function adminUpdateApp(id: string, patch: { agentSlugs?: string[]; revoke?: boolean; name?: string }, by: string) {
  const db = getDb();
  const [before] = await db.select().from(developerApps).where(eq(developerApps.id, id)).limit(1);
  if (!before) return { error: "not_found" as const };
  const set: Partial<typeof developerApps.$inferInsert> = {};
  if (patch.agentSlugs) {
    const bad = patch.agentSlugs.filter((k) => !(k in A2A_AGENTS));
    if (bad.length) return { error: "unknown_agent" as const };
    set.agentSlugs = [...new Set(patch.agentSlugs)];
  }
  if (patch.name !== undefined) set.name = patch.name.trim().slice(0, 80) || before.name;
  if (patch.revoke && !before.revokedAt) set.revokedAt = new Date();
  const [row] = Object.keys(set).length ? await db.update(developerApps).set(set).where(eq(developerApps.id, id)).returning() : [before];
  await adminAudit(by, patch.revoke ? "application_revoked" : "application_updated", { appId: id, clientId: before.clientId, changes: patch });
  return { app: publicApp(row!) };
}

// ─── Logs ────────────────────────────────────────────────────────────────────

/** A cursor over (created_at, id), newest first. */
const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decodeCursor(c: string | null | undefined): { at: Date; id: string } | null {
  if (!c) return null;
  try {
    const [at, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
    const d = new Date(at!);
    return Number.isNaN(d.getTime()) || !id ? null : { at: d, id };
  } catch {
    return null;
  }
}

export interface RequestFilter {
  accountId?: string;
  appId?: string;
  agent?: string;
  method?: string;
  outcome?: "ok" | "error";
  cursor?: string;
  limit?: number;
}

export async function adminRequests(f: RequestFilter) {
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const where: SQL[] = [];
  if (f.appId) where.push(eq(a2aRequests.appId, f.appId));
  if (f.accountId) where.push(eq(developerApps.accountId, f.accountId));
  if (f.agent) where.push(eq(a2aRequests.agentSlug, f.agent));
  if (f.method) where.push(eq(a2aRequests.method, f.method));
  if (f.outcome) where.push(eq(a2aRequests.ok, f.outcome === "ok"));
  const cur = decodeCursor(f.cursor);
  if (cur) where.push(or(lt(a2aRequests.createdAt, cur.at), and(eq(a2aRequests.createdAt, cur.at), lt(a2aRequests.id, cur.id)))!);
  const rows = await getDb()
    .select({ r: a2aRequests, appName: developerApps.name, clientId: developerApps.clientId, email: developerAccounts.email, organization: developerAccounts.organization })
    .from(a2aRequests)
    .leftJoin(developerApps, eq(a2aRequests.appId, developerApps.id))
    .leftJoin(developerAccounts, eq(developerApps.accountId, developerAccounts.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(a2aRequests.createdAt), desc(a2aRequests.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page[page.length - 1]!.r : null;
  return {
    requests: page.map(({ r, appName, clientId, email, organization }) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      method: r.method,
      binding: r.binding,
      agentSlug: r.agentSlug,
      taskId: r.taskId,
      ok: r.ok,
      httpStatus: r.httpStatus,
      errorCode: r.errorCode,
      latencyMs: r.latencyMs,
      appId: r.appId,
      appName,
      clientId,
      accountEmail: email,
      organization,
    })),
    nextCursor: last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export interface TaskFilter {
  accountId?: string;
  appId?: string;
  state?: string;
  cursor?: string;
  limit?: number;
}

export async function adminTasks(f: TaskFilter) {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const where: SQL[] = [];
  if (f.appId) where.push(eq(a2aTasks.appId, f.appId));
  if (f.accountId) where.push(eq(developerApps.accountId, f.accountId));
  if (f.state) where.push(eq(a2aTasks.state, f.state));
  const cur = decodeCursor(f.cursor);
  if (cur) where.push(or(lt(a2aTasks.updatedAt, cur.at), and(eq(a2aTasks.updatedAt, cur.at), lt(a2aTasks.id, cur.id)))!);
  const rows = await getDb()
    .select({ t: a2aTasks, appName: developerApps.name, email: developerAccounts.email, organization: developerAccounts.organization })
    .from(a2aTasks)
    .innerJoin(developerApps, eq(a2aTasks.appId, developerApps.id))
    .innerJoin(developerAccounts, eq(developerApps.accountId, developerAccounts.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(a2aTasks.updatedAt), desc(a2aTasks.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page[page.length - 1]!.t : null;
  return {
    tasks: page.map(({ t, appName, email, organization }) => {
      const status = t.status as { message?: { parts?: { text?: string }[] } };
      const meta = (t.metadata ?? {}) as Record<string, unknown>;
      return {
        id: t.id,
        contextId: t.conversationId,
        agentSlug: t.agentSlug,
        state: t.state,
        awaiting: t.awaiting,
        journey: typeof meta.journey === "string" ? meta.journey : null,
        persona: typeof meta.persona === "string" ? meta.persona : null,
        lastText: (status?.message?.parts?.find((p) => typeof p.text === "string")?.text ?? "").slice(0, 300),
        messages: Array.isArray(t.history) ? t.history.length : 0,
        artifacts: Array.isArray(t.artifacts) ? (t.artifacts as { name?: string }[]).map((a) => a.name ?? "artifact") : [],
        appId: t.appId,
        appName,
        accountEmail: email,
        organization,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
    }),
    nextCursor: last ? encodeCursor(last.updatedAt, last.id) : null,
  };
}

/** One task in full: its history, artifacts and status, as the client sees them. */
export async function adminTask(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb()
    .select({ t: a2aTasks, appName: developerApps.name, email: developerAccounts.email })
    .from(a2aTasks)
    .innerJoin(developerApps, eq(a2aTasks.appId, developerApps.id))
    .innerJoin(developerAccounts, eq(developerApps.accountId, developerAccounts.id))
    .where(eq(a2aTasks.id, id))
    .limit(1);
  if (!row) return null;
  const t = row.t;
  return {
    id: t.id,
    contextId: t.conversationId,
    agentSlug: t.agentSlug,
    state: t.state,
    awaiting: t.awaiting,
    status: t.status,
    history: t.history,
    artifacts: t.artifacts,
    metadata: t.metadata,
    appName: row.appName,
    accountEmail: row.email,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export type EventScope = "portal" | "sandbox" | "all";

export interface EventFilter {
  scope?: EventScope;
  q?: string;
  action?: string;
  cursor?: string;
  limit?: number;
}

/**
 * The audit trail. "portal": sign-ins, account and application changes, admin
 * actions. "sandbox": everything the sandbox agent's conversations wrote
 * (tool calls, payments, corrections). "all": the whole audit log.
 */
export async function adminEvents(f: EventFilter) {
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const db = getDb();
  const where: SQL[] = [];
  const scope = f.scope ?? "portal";
  if (scope !== "all") {
    const sandboxKeys = Object.values(A2A_AGENTS).map((a) => a.dialogSlug);
    const sandboxAgents = await db.select({ id: agents.id }).from(agents).where(inArray(agents.slug, sandboxKeys));
    const ids = sandboxAgents.map((a) => a.id);
    if (scope === "portal") where.push(or(like(auditLog.action, "developer_%"), eq(auditLog.action, "sandbox_agent_synced"))!);
    else where.push(ids.length ? inArray(auditLog.agentId, ids) : sql`false`);
  }
  if (f.action) where.push(eq(auditLog.action, f.action));
  if (f.q) where.push(or(ilike(auditLog.action, `%${f.q}%`), sql`${auditLog.payload}::text ilike ${`%${f.q}%`}`)!);
  const cur = decodeCursor(f.cursor);
  if (cur) where.push(or(lt(auditLog.createdAt, cur.at), and(eq(auditLog.createdAt, cur.at), lt(auditLog.id, cur.id)))!);
  const rows = await db
    .select({ e: auditLog, agentSlug: agents.slug })
    .from(auditLog)
    .leftJoin(agents, eq(auditLog.agentId, agents.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page[page.length - 1]!.e : null;
  return {
    events: page.map(({ e, agentSlug }) => {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      return {
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        actor: e.actor,
        action: e.action,
        by: typeof payload.by === "string" ? payload.by : null,
        agentSlug,
        conversationId: e.conversationId,
        payload,
      };
    }),
    nextCursor: last ? encodeCursor(last.createdAt, last.id) : null,
  };
}
