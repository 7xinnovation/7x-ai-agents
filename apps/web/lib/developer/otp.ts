/**
 * Sign-in to the developer portal by one-time code (2026-10-15).
 *
 * No passwords. The person types their email; if it belongs to an active
 * account, a six-digit code is emailed to it. Only the code's hash is stored,
 * bound to the account, for ten minutes and five attempts. A new code replaces
 * the old one and is not sent more than once a minute. The answer to "send me
 * a code" is the same whether or not the address has an account, so the form
 * cannot be used to find out who does.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, developerAccounts } from "@dialog/db";
import { sendEmail, textToHtml } from "@/lib/email";
import { log } from "@/lib/logger";
import { getSettings } from "./settings";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_AFTER_MS = 60 * 1000;
/** The portal's own sender: RESEND_API_KEY_DEVELOPERS and EMAIL_FROM_DEVELOPERS, else the shared ones. */
export const OTP_EMAIL_TENANT = "developers";

const hashCode = (accountId: string, code: string) => createHash("sha256").update(`${accountId}:${code}`).digest("hex");

const sameHex = (a: string, b: string) => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
};

export type RequestOutcome = "sent" | "throttled" | "no_account" | "send_failed";

export async function requestSignInCode(rawEmail: string, origin?: string): Promise<RequestOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const db = getDb();
  const [account] = await db.select().from(developerAccounts).where(eq(developerAccounts.email, email)).limit(1);
  if (!account || !account.active) return "no_account";
  if (account.otpSentAt && Date.now() - account.otpSentAt.getTime() < OTP_RESEND_AFTER_MS) return "throttled";

  const { codeTtlMinutes } = await getSettings();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db
    .update(developerAccounts)
    .set({ otpHash: hashCode(account.id, code), otpExpiresAt: new Date(Date.now() + codeTtlMinutes * 60_000), otpAttempts: 0, otpSentAt: new Date() })
    .where(eq(developerAccounts.id, account.id));

  const text =
    `Your sign-in code for Dialog Developers is:\n\n${code}\n\n` +
    `It expires in ${codeTtlMinutes} minutes and works once. If you did not try to sign in, you can ignore this email.\n\n` +
    `${account.organization}, ${email}` +
    (origin ? `\n${origin}/developers` : "");
  const result = await sendEmail({
    tenant: OTP_EMAIL_TENANT,
    to: email,
    subject: `${code} is your Dialog Developers sign-in code`,
    text,
    html: textToHtml(text, "Sign in to Dialog Developers", { name: "7X Dialog Developers", logoUrl: null, baseUrl: origin ?? null }),
  });
  if (!result.ok) {
    // Local development without an email provider: the code goes to the server log so the flow can be tested.
    if (process.env.NODE_ENV !== "production") {
      log.warn("developer_otp_not_sent_dev_code", { email, code, reason: result.reason });
      return "sent";
    }
    log.error("developer_otp_send_failed", new Error(result.reason ?? "send failed"), { email });
    return "send_failed";
  }
  return "sent";
}

export type VerifyOutcome =
  | { ok: true; account: typeof developerAccounts.$inferSelect }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts" };

export async function verifySignInCode(rawEmail: string, rawCode: string): Promise<VerifyOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.replace(/\D/g, "");
  const db = getDb();
  const [account] = await db.select().from(developerAccounts).where(eq(developerAccounts.email, email)).limit(1);
  if (!account || !account.active || !account.otpHash || !account.otpExpiresAt) return { ok: false, reason: "invalid" };
  if (account.otpExpiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  const { codeMaxAttempts } = await getSettings();
  if (account.otpAttempts >= codeMaxAttempts) return { ok: false, reason: "too_many_attempts" };

  if (code.length !== 6 || !sameHex(account.otpHash, hashCode(account.id, code))) {
    await db
      .update(developerAccounts)
      .set({ otpAttempts: account.otpAttempts + 1 })
      .where(eq(developerAccounts.id, account.id));
    return { ok: false, reason: account.otpAttempts + 1 >= codeMaxAttempts ? "too_many_attempts" : "invalid" };
  }
  // Spend the code atomically: a second use, or a race with another tab, finds no hash.
  const [signedIn] = await db
    .update(developerAccounts)
    .set({ otpHash: null, otpExpiresAt: null, otpAttempts: 0, lastLoginAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null })
    .where(and(eq(developerAccounts.id, account.id), eq(developerAccounts.otpHash, account.otpHash)))
    .returning();
  if (!signedIn) return { ok: false, reason: "invalid" };
  return { ok: true, account: signedIn };
}
