import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";

/**
 * Symmetric encryption for secrets stored at rest (PRD: encryption at rest;
 * integration API tokens must not be plaintext in the DB). AES-256-GCM with a
 * key derived from SECRETS_KEY (or, as a dev fallback, ADMIN_SESSION_SECRET).
 *
 * Stored format: `enc:v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`. Values without
 * the `enc:v1:` prefix are treated as legacy plaintext and returned as-is, so
 * existing rows keep working and get re-encrypted on next write.
 */
const PREFIX = "enc:v1:";

function key(): Buffer {
  const material = process.env.SECRETS_KEY || process.env.ADMIN_SESSION_SECRET || "dialog-dev-insecure-key";
  // Stable 32-byte key. scrypt with a fixed salt derived from the material name.
  const salt = createHash("sha256").update("dialog-secrets-salt").digest();
  return scryptSync(material, salt, 32);
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return plain ?? null;
  if (plain.startsWith(PREFIX)) return plain; // already encrypted
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === "") return stored ?? null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  try {
    const [, , ivB64, tagB64, ctB64] = stored.split(":");
    const iv = Buffer.from(ivB64!, "base64");
    const tag = Buffer.from(tagB64!, "base64");
    const ct = Buffer.from(ctB64!, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null; // tampered or wrong key
  }
}

export const isEncrypted = (v: string | null | undefined): boolean => !!v && v.startsWith(PREFIX);
