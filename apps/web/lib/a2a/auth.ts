/**
 * Who is calling the doorway.
 *
 * Every application a developer account creates has two credentials for the
 * same identity: an OAuth 2.0 client (client_id + client_secret, exchanged for a
 * one-hour bearer token on /a2a/oauth/token) and an API key sent as X-API-Key.
 * Only SHA-256 hashes are stored; the secret and the key are shown once, at
 * creation or rotation. The Agent Card advertises both schemes.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, developerApps } from "@dialog/db";
import { A2AError } from "@dialog/core";
import { derivedSecret, signJwt, verifyJwt, type JwtClaims } from "@/lib/developer/jwt";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const TOKEN_SECRET_LABEL = "a2a-access-token";

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export const newClientId = (): string => `dlg_${randomBytes(8).toString("hex")}`;
export const newClientSecret = (): string => `dlgs_${randomBytes(32).toString("base64url")}`;
export const newApiKey = (): string => `dlgk_sandbox_${randomBytes(32).toString("base64url")}`;

const sameHash = (a: string, b: string): boolean => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
};

export interface AuthedApp {
  id: string;
  accountId: string;
  name: string;
  clientId: string;
  agentSlugs: string[];
  scopes: string[];
  via: "api_key" | "bearer";
}

type AppRow = typeof developerApps.$inferSelect;

const toAuthed = (row: AppRow, via: AuthedApp["via"]): AuthedApp => ({
  id: row.id,
  accountId: row.accountId,
  name: row.name,
  clientId: row.clientId,
  agentSlugs: row.agentSlugs ?? [],
  scopes: row.scopes ?? [],
  via,
});

export async function appByClientId(clientId: string): Promise<AppRow | null> {
  const [row] = await getDb().select().from(developerApps).where(eq(developerApps.clientId, clientId)).limit(1);
  return row ?? null;
}

/** Note the application was used. Best-effort and throttled to once a minute per process. */
const lastTouched = new Map<string, number>();
function touch(appId: string): void {
  const now = Date.now();
  if ((lastTouched.get(appId) ?? 0) > now - 60_000) return;
  lastTouched.set(appId, now);
  void getDb()
    .update(developerApps)
    .set({ lastUsedAt: new Date() })
    .where(eq(developerApps.id, appId))
    .catch(() => {});
}

interface AccessClaims extends JwtClaims {
  iss: string;
  sub: string;
  app: string;
  scope: string;
}

/** The client-credentials grant: a client id and secret for a one-hour bearer token. */
export async function issueAccessToken(
  clientId: string,
  clientSecret: string,
  requestedScope?: string
): Promise<{ access_token: string; token_type: "Bearer"; expires_in: number; scope: string } | { error: string; error_description: string }> {
  const row = clientId ? await appByClientId(clientId) : null;
  if (!row || row.revokedAt || !clientSecret || !sameHash(row.clientSecretHash, sha256(clientSecret))) {
    return { error: "invalid_client", error_description: "Unknown client or wrong secret." };
  }
  const granted = row.scopes ?? ["tasks"];
  const asked = (requestedScope ?? "").split(/\s+/).filter(Boolean);
  const bad = asked.filter((s) => !granted.includes(s));
  if (bad.length) return { error: "invalid_scope", error_description: `Not granted to this client: ${bad.join(", ")}` };
  const scope = (asked.length ? asked : granted).join(" ");
  const token = await signJwt({ iss: "dialog-a2a", sub: row.clientId, app: row.id, scope }, derivedSecret(TOKEN_SECRET_LABEL), ACCESS_TOKEN_TTL_SECONDS);
  touch(row.id);
  return { access_token: token, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, scope };
}

/** A token for an application the portal user owns — what the Console uses, so the secret is never in the browser. */
export async function tokenForApp(appId: string): Promise<{ access_token: string; expires_in: number } | null> {
  const [row] = await getDb().select().from(developerApps).where(and(eq(developerApps.id, appId), isNull(developerApps.revokedAt))).limit(1);
  if (!row) return null;
  const scope = (row.scopes ?? ["tasks"]).join(" ");
  const token = await signJwt({ iss: "dialog-a2a", sub: row.clientId, app: row.id, scope }, derivedSecret(TOKEN_SECRET_LABEL), ACCESS_TOKEN_TTL_SECONDS);
  return { access_token: token, expires_in: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * The application behind a request, or an A2A authentication error. Accepts
 * `Authorization: Bearer <access token>`, `Authorization: Bearer <api key>` and
 * `X-API-Key: <api key>`.
 */
export async function authenticateRequest(req: Request): Promise<AuthedApp> {
  const header = req.headers.get("authorization") ?? "";
  const bearer = /^bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim();
  const apiKey = req.headers.get("x-api-key")?.trim() || (bearer && /^dlgk_/.test(bearer) ? bearer : undefined);

  if (apiKey) {
    const [row] = await getDb().select().from(developerApps).where(eq(developerApps.apiKeyHash, sha256(apiKey))).limit(1);
    if (!row || row.revokedAt) throw new A2AError("UnauthenticatedError", "the API key is not recognised or has been revoked");
    touch(row.id);
    return toAuthed(row, "api_key");
  }
  if (bearer) {
    const claims = await verifyJwt<AccessClaims>(bearer, derivedSecret(TOKEN_SECRET_LABEL));
    if (!claims || claims.iss !== "dialog-a2a" || !claims.app) throw new A2AError("UnauthenticatedError", "the access token is invalid or has expired");
    const [row] = await getDb().select().from(developerApps).where(eq(developerApps.id, claims.app)).limit(1);
    if (!row || row.revokedAt || row.clientId !== claims.sub) throw new A2AError("UnauthenticatedError", "the access token belongs to a revoked application");
    if (row.rotatedAt && claims.iat && row.rotatedAt.getTime() / 1000 > claims.iat) {
      throw new A2AError("UnauthenticatedError", "the credentials were rotated after this token was issued");
    }
    touch(row.id);
    return toAuthed(row, "bearer");
  }
  throw new A2AError("UnauthenticatedError", "send Authorization: Bearer <token> or X-API-Key: <key>");
}

/** May this application address this A2A agent? */
export function assertMayCall(app: AuthedApp, agentKey: string): void {
  if (!app.agentSlugs.includes(agentKey)) {
    throw new A2AError("PermissionDeniedError", `this application is not enabled for the agent "${agentKey}"`, { agent: agentKey });
  }
}
