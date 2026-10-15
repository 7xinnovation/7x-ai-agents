/**
 * Developer accounts and their applications.
 *
 * An account is invited (random token, SHA-256 stored, one week, single use)
 * and sets its own password. It then creates applications; each application
 * gets an OAuth client and an API key, shown once. Rotation replaces both;
 * revocation ends the application. Everything the account can read is scoped
 * to its own applications.
 */
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb, developerAccounts, developerApps, a2aRequests, a2aTasks } from "@dialog/db";
import { hashPassword, verifyPassword, newInviteToken, hashInviteToken } from "@/lib/users";
import { newApiKey, newClientId, newClientSecret, sha256 } from "@/lib/a2a/auth";
import { A2A_AGENTS } from "@/lib/a2a/catalogue";
import { getSettings } from "./settings";

export type DeveloperAccount = typeof developerAccounts.$inferSelect;
export type DeveloperApp = typeof developerApps.$inferSelect;

export const MIN_PASSWORD_LENGTH = 10;

export async function accountByEmail(email: string): Promise<DeveloperAccount | null> {
  const [row] = await getDb().select().from(developerAccounts).where(eq(developerAccounts.email, email.trim().toLowerCase())).limit(1);
  return row ?? null;
}

export async function accountById(id: string): Promise<DeveloperAccount | null> {
  const [row] = await getDb().select().from(developerAccounts).where(eq(developerAccounts.id, id)).limit(1);
  return row ?? null;
}

export async function loginDeveloper(email: string, password: string): Promise<DeveloperAccount | null> {
  const row = await accountByEmail(email);
  if (!row || !row.active || !row.passwordHash) return null;
  if (!verifyPassword(password, row.passwordHash)) return null;
  await getDb().update(developerAccounts).set({ lastLoginAt: new Date() }).where(eq(developerAccounts.id, row.id));
  return row;
}

/**
 * Create the account, or re-invite an existing one. Returns the raw invite
 * token exactly once; only its hash is kept.
 */
export async function inviteDeveloper(input: {
  organization: string;
  name: string;
  email: string;
  invitedBy?: string;
}): Promise<{ account: DeveloperAccount; token: string; expiresAt: Date; created: boolean }> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const invite = newInviteToken();
  const existing = await accountByEmail(email);
  if (existing) {
    const [row] = await db
      .update(developerAccounts)
      .set({
        organization: input.organization.trim() || existing.organization,
        name: input.name.trim() || existing.name,
        inviteTokenHash: invite.hash,
        inviteExpiresAt: invite.expiresAt,
        invitedBy: input.invitedBy ?? existing.invitedBy,
        active: true,
      })
      .where(eq(developerAccounts.id, existing.id))
      .returning();
    return { account: row!, token: invite.token, expiresAt: invite.expiresAt, created: false };
  }
  const [row] = await db
    .insert(developerAccounts)
    .values({
      organization: input.organization.trim(),
      name: input.name.trim(),
      email,
      inviteTokenHash: invite.hash,
      inviteExpiresAt: invite.expiresAt,
      invitedBy: input.invitedBy ?? null,
    })
    .returning();
  return { account: row!, token: invite.token, expiresAt: invite.expiresAt, created: true };
}

export async function accountByInviteToken(token: string): Promise<DeveloperAccount | null> {
  if (!token || token.length < 20) return null;
  const [row] = await getDb()
    .select()
    .from(developerAccounts)
    .where(and(eq(developerAccounts.inviteTokenHash, hashInviteToken(token)), gt(developerAccounts.inviteExpiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Set the password and spend the invitation, atomically: a second use finds no row. */
export async function acceptDeveloperInvite(token: string, password: string): Promise<DeveloperAccount | null> {
  if (password.length < MIN_PASSWORD_LENGTH) return null;
  const [row] = await getDb()
    .update(developerAccounts)
    .set({ passwordHash: hashPassword(password), inviteTokenHash: null, inviteExpiresAt: null, lastLoginAt: new Date(), active: true })
    .where(and(eq(developerAccounts.inviteTokenHash, hashInviteToken(token)), gt(developerAccounts.inviteExpiresAt, new Date())))
    .returning();
  return row ?? null;
}

// ─── Applications ────────────────────────────────────────────────────────────

/** What a developer may see of an application: never a hash. */
export function publicApp(app: DeveloperApp) {
  return {
    id: app.id,
    name: app.name,
    clientId: app.clientId,
    apiKeyHint: app.apiKeyHint,
    agentSlugs: app.agentSlugs ?? [],
    scopes: app.scopes ?? [],
    createdAt: app.createdAt.toISOString(),
    rotatedAt: app.rotatedAt?.toISOString() ?? null,
    revokedAt: app.revokedAt?.toISOString() ?? null,
    lastUsedAt: app.lastUsedAt?.toISOString() ?? null,
  };
}

export async function listApps(accountId: string) {
  const rows = await getDb().select().from(developerApps).where(eq(developerApps.accountId, accountId)).orderBy(desc(developerApps.createdAt));
  return rows.map(publicApp);
}

/** The agents a new application may call: every sandbox agent in the catalogue. */
export function defaultAgentSlugs(): string[] {
  return Object.values(A2A_AGENTS)
    .filter((a) => a.sandbox)
    .map((a) => a.key);
}

export async function createApp(accountId: string, name: string) {
  const clientSecret = newClientSecret();
  const apiKey = newApiKey();
  const [row] = await getDb()
    .insert(developerApps)
    .values({
      accountId,
      name: name.trim().slice(0, 80) || "Untitled application",
      clientId: newClientId(),
      clientSecretHash: sha256(clientSecret),
      apiKeyHash: sha256(apiKey),
      apiKeyHint: apiKey.slice(-4),
      agentSlugs: (await getSettings()).defaultAgents,
      scopes: ["tasks"],
    })
    .returning();
  return { app: publicApp(row!), clientSecret, apiKey };
}

export async function appForAccount(accountId: string, appId: string): Promise<DeveloperApp | null> {
  if (!/^[0-9a-f-]{36}$/i.test(appId)) return null;
  const [row] = await getDb().select().from(developerApps).where(and(eq(developerApps.id, appId), eq(developerApps.accountId, accountId))).limit(1);
  return row ?? null;
}

export async function rotateApp(accountId: string, appId: string) {
  const app = await appForAccount(accountId, appId);
  if (!app || app.revokedAt) return null;
  const clientSecret = newClientSecret();
  const apiKey = newApiKey();
  const [row] = await getDb()
    .update(developerApps)
    .set({ clientSecretHash: sha256(clientSecret), apiKeyHash: sha256(apiKey), apiKeyHint: apiKey.slice(-4), rotatedAt: new Date() })
    .where(eq(developerApps.id, app.id))
    .returning();
  return { app: publicApp(row!), clientSecret, apiKey };
}

export async function revokeApp(accountId: string, appId: string) {
  const app = await appForAccount(accountId, appId);
  if (!app) return null;
  if (app.revokedAt) return publicApp(app);
  const [row] = await getDb().update(developerApps).set({ revokedAt: new Date() }).where(eq(developerApps.id, app.id)).returning();
  return publicApp(row!);
}

export async function renameApp(accountId: string, appId: string, name: string) {
  const app = await appForAccount(accountId, appId);
  if (!app) return null;
  const [row] = await getDb()
    .update(developerApps)
    .set({ name: name.trim().slice(0, 80) || app.name })
    .where(eq(developerApps.id, app.id))
    .returning();
  return publicApp(row!);
}

// ─── What the account can read back ──────────────────────────────────────────

async function appIdsOf(accountId: string): Promise<string[]> {
  const rows = await getDb().select({ id: developerApps.id }).from(developerApps).where(eq(developerApps.accountId, accountId));
  return rows.map((r) => r.id);
}

export async function recentRequests(accountId: string, limit = 100) {
  const ids = await appIdsOf(accountId);
  if (!ids.length) return [];
  const rows = await getDb()
    .select({
      id: a2aRequests.id,
      appId: a2aRequests.appId,
      agentSlug: a2aRequests.agentSlug,
      taskId: a2aRequests.taskId,
      method: a2aRequests.method,
      binding: a2aRequests.binding,
      ok: a2aRequests.ok,
      errorCode: a2aRequests.errorCode,
      httpStatus: a2aRequests.httpStatus,
      latencyMs: a2aRequests.latencyMs,
      createdAt: a2aRequests.createdAt,
    })
    .from(a2aRequests)
    .where(inArray(a2aRequests.appId, ids))
    .orderBy(desc(a2aRequests.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function recentTasks(accountId: string, limit = 50) {
  const ids = await appIdsOf(accountId);
  if (!ids.length) return [];
  const rows = await getDb()
    .select({
      id: a2aTasks.id,
      appId: a2aTasks.appId,
      agentSlug: a2aTasks.agentSlug,
      contextId: a2aTasks.conversationId,
      state: a2aTasks.state,
      awaiting: a2aTasks.awaiting,
      metadata: a2aTasks.metadata,
      status: a2aTasks.status,
      createdAt: a2aTasks.createdAt,
      updatedAt: a2aTasks.updatedAt,
    })
    .from(a2aTasks)
    .where(inArray(a2aTasks.appId, ids))
    .orderBy(desc(a2aTasks.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => {
    const status = r.status as { message?: { parts?: { text?: string }[] } } | null;
    const lastText = status?.message?.parts?.find((p) => typeof p.text === "string")?.text ?? "";
    return {
      id: r.id,
      appId: r.appId,
      agentSlug: r.agentSlug,
      contextId: r.contextId,
      state: r.state,
      awaiting: r.awaiting,
      journey: (r.metadata as Record<string, unknown> | null)?.journey ?? null,
      persona: (r.metadata as Record<string, unknown> | null)?.persona ?? null,
      lastText: lastText.slice(0, 240),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

export async function usageSummary(accountId: string) {
  const ids = await appIdsOf(accountId);
  if (!ids.length) return { requests24h: 0, errors24h: 0, tasks: 0, openTasks: 0 };
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [req] = await db
    .select({ n: sql<number>`count(*)`, errors: sql<number>`count(*) filter (where not ${a2aRequests.ok})` })
    .from(a2aRequests)
    .where(and(inArray(a2aRequests.appId, ids), gt(a2aRequests.createdAt, since)));
  const [tasks] = await db
    .select({
      n: sql<number>`count(*)`,
      open: sql<number>`count(*) filter (where ${a2aTasks.state} in ('TASK_STATE_WORKING','TASK_STATE_INPUT_REQUIRED','TASK_STATE_AUTH_REQUIRED','TASK_STATE_SUBMITTED'))`,
    })
    .from(a2aTasks)
    .where(inArray(a2aTasks.appId, ids));
  return { requests24h: Number(req?.n ?? 0), errors24h: Number(req?.errors ?? 0), tasks: Number(tasks?.n ?? 0), openTasks: Number(tasks?.open ?? 0) };
}

export { isNull };
