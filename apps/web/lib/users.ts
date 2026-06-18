import { getDb, users } from "@dialog/db";
import { eq, asc } from "drizzle-orm";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export type Role = "owner" | "admin" | "editor" | "viewer";

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

export async function getUserByEmail(email: string) {
  const [u] = await getDb().select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return u ?? null;
}

export async function listUsers() {
  return getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, provider: users.provider, active: users.active, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
    .from(users)
    .orderBy(asc(users.createdAt));
}

export async function createUser(input: { email: string; name: string; password?: string; role: Role; provider?: "password" | "entra" }) {
  const [u] = await getDb()
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: input.password ? hashPassword(input.password) : null,
      role: input.role,
      provider: input.provider ?? "password",
    })
    .returning();
  return u!;
}

export async function updateUser(id: string, patch: { role?: Role; active?: boolean; name?: string; password?: string }) {
  const set: Record<string, unknown> = {};
  if (patch.role) set.role = patch.role;
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
