import { getDb, users } from "@dialog/db";
import { eq, asc, and, gt, sql } from "drizzle-orm";
import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

export type Role = "owner" | "admin" | "editor" | "viewer";

/**
 * Which agents an account may see.
 *
 * An empty scope is every agent — that is what every account has had until now,
 * and what owners and admins keep. A non-empty scope is an allow-list of agent
 * SLUGS, so a reviewer given Emirates Post cannot read EPGL's licence
 * applications, and the other way round.
 *
 * Scoping applies to accounts BELOW admin. An owner or admin manages users and
 * integrations, so restricting what they can read would be theatre: they can
 * lift their own restriction.
 */
export function scopeApplies(role: Role): boolean {
  return role === "viewer" || role === "editor";
}

/** May this account see this agent? */
export function canSeeAgent(user: { role: Role; agentScope?: string[] | null }, slug: string): boolean {
  if (!scopeApplies(user.role)) return true;
  const scope = user.agentScope ?? [];
  return scope.length === 0 || scope.includes(slug);
}

/** scrypt password hash, stored as "salt:hash" (hex). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored || !stored.includes(":")) return false;
  const [saltHex, hashHex] = stored.split(":");
  try {
    const salt = Buffer.from(saltHex!, "hex");
    const expected = Buffer.from(hashHex!, "hex");
    const actual = scryptSync(plain, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * An invitation to the console.
 *
 * The link carries a 32-byte random token; only its SHA-256 is stored, so an
 * invitation cannot be replayed from a database dump or a log line the way a
 * stored token could. It is single use — accepting clears it — and it expires,
 * because an invitation left open is a password reset left open.
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function newInviteToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The account an unexpired invitation belongs to, if the token is one. */
export async function userByInviteToken(token: string) {
  if (!token || token.length < 20) return null;
  const [u] = await getDb().select().from(users).where(eq(users.inviteTokenHash, hashInviteToken(token))).limit(1);
  if (!u || !u.inviteExpiresAt || u.inviteExpiresAt.getTime() < Date.now()) return null;
  return u;
}

/** Open (or reopen) an invitation, returning the token for the link. */
export async function inviteUser(id: string, invitedBy?: string | null): Promise<string> {
  const { token, hash, expiresAt } = newInviteToken();
  await getDb()
    .update(users)
    .set({ inviteTokenHash: hash, inviteExpiresAt: expiresAt, invitedBy: invitedBy ?? null, active: true })
    .where(eq(users.id, id));
  return token;
}

/**
 * Accept an invitation: the password is set and the invitation is spent.
 *
 * Written as one conditional statement so a token can only ever be redeemed
 * once, whatever arrives at the same moment.
 */
export async function acceptInvite(token: string, password: string) {
  const hash = hashInviteToken(token);
  const [u] = await getDb()
    .update(users)
    .set({ passwordHash: hashPassword(password), inviteTokenHash: null, inviteExpiresAt: null, active: true })
    .where(and(eq(users.inviteTokenHash, hash), gt(users.inviteExpiresAt, new Date())))
    .returning();
  return u ?? null;
}

export async function getUserByEmail(email: string) {
  const [u] = await getDb().select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return u ?? null;
}

export async function listUsers() {
  return getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      provider: users.provider,
      active: users.active,
      agentScope: users.agentScope,
      // Whether an invitation is still open, never the token that would open it.
      invited: sql<boolean>`(${users.passwordHash} is null and ${users.inviteTokenHash} is not null)`,
      inviteExpiresAt: users.inviteExpiresAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));
}

export async function createUser(input: { email: string; name: string; password?: string; role: Role; provider?: "password" | "entra"; agentScope?: string[] }) {
  const [u] = await getDb()
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: input.password ? hashPassword(input.password) : null,
      role: input.role,
      provider: input.provider ?? "password",
      agentScope: input.agentScope ?? [],
    })
    .returning();
  return u!;
}

export async function updateUser(
  id: string,
  patch: { role?: Role; active?: boolean; name?: string; password?: string; agentScope?: string[] }
) {
  const set: Record<string, unknown> = {};
  if (patch.role) set.role = patch.role;
  // An empty list means every agent, which is what an unscoped account is.
  if (patch.agentScope) set.agentScope = patch.agentScope;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.name) set.name = patch.name;
  if (patch.password) set.passwordHash = hashPassword(patch.password);
  if (Object.keys(set).length === 0) return;
  await getDb().update(users).set(set).where(eq(users.id, id));
}

export async function markLogin(id: string) {
  await getDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
}

export async function countUsers(): Promise<number> {
  const rows = await getDb().select({ id: users.id }).from(users);
  return rows.length;
}

/** Ensure a bootstrap owner exists from env (idempotent). Returns it if created. */
export async function ensureBootstrapOwner() {
  const email = (process.env.ADMIN_EMAIL || "admin@7x.ae").toLowerCase();
  const existing = await getUserByEmail(email);
  if (existing) return existing;
  const password = process.env.ADMIN_PASSWORD || "change-me";
  return createUser({ email, name: "Administrator", password, role: "owner" });
}

/**
 * The agent scope of whoever is looking, read from the DATABASE rather than the
 * session cookie.
 *
 * The cookie carries the scope too — the middleware needs it at the edge, where
 * there is no database — but a cookie lasts eight hours, so an admin who
 * narrows someone's access would otherwise not have narrowed anything until
 * that person next signed in. The pages have a database; they should use it.
 *
 * Returns null for "every agent", or the allow-list of slugs.
 */
export async function scopeOf(claims: { uid?: string; role?: Role } | null | undefined): Promise<string[] | null> {
  if (!claims?.uid || !claims.role || !scopeApplies(claims.role)) return null;
  const [u] = await getDb().select({ scope: users.agentScope }).from(users).where(eq(users.id, claims.uid)).limit(1);
  const scope = u?.scope ?? [];
  return scope.length ? scope : null;
}
