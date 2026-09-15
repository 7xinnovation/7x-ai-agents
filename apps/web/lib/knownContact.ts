import type { CaseState } from "@dialog/config";

/**
 * The contact details the customer has already given Emirates Post.
 *
 * Signing in hands us their account record — the mobile and the email on it —
 * and the journey then asked for both again, from someone who had just proved
 * who they were. Emirates Post asked for the ones on file to be SHOWN, so the
 * customer confirms or corrects them instead of typing them out.
 *
 * They are seeded, not imposed: an answer the customer has already given in this
 * conversation always wins, and the confirmation step is where they can change
 * either. Nothing is ever overwritten.
 */
export interface KnownContact {
  mobile?: string;
  email?: string;
  /**
   * The name UAE PASS states for them.
   *
   * It was parsed at sign-in and thrown away: only the mobile and the email were
   * seeded, so a signed-in EPGL applicant was still asked "what's your name and
   * email address?" on the first turn. Half of that question we could already
   * answer, and the other half we had been handed too.
   */
  name?: string;
}

/** The case fields these map to, in the order the journeys spell them. */
const PHONE_KEYS = ["contact_phone", "phone", "mobile", "mobileNumber"];
const EMAIL_KEYS = ["contact_email", "email", "emailAddress"];
const NAME_KEYS = ["contact_name", "applicant_name", "customer_name", "full_name"];

const filled = (data: Record<string, unknown>, keys: string[]): boolean =>
  keys.some((k) => {
    const v = data[k];
    return typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null && v !== "";
  });

/** A UAE mobile as Emirates Post writes it, or nothing. */
export function tidyMobile(raw: string | undefined): string | undefined {
  const digits = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return undefined;
  // 0553708434, 553708434, +971553708434 and 971553708434 are all the same
  // number; the journeys and the save payloads use the local 05x form.
  const local = digits.replace(/^\+?971/, "0").replace(/^(?!0)(5\d{8})$/, "0$1");
  return /^0\d{8,9}$/.test(local) ? local : /^\+?\d{7,15}$/.test(digits) ? digits : undefined;
}

/**
 * A person's name, or nothing.
 *
 * UAE PASS returns fullnameEN, and occasionally returns a placeholder for a
 * profile that has not been completed. Anything without two letters and a space
 * is not a name worth showing back to somebody as theirs.
 */
export function tidyName(raw: string | undefined): string | undefined {
  const v = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (v.length < 3 || !/\p{L}{2}/u.test(v)) return undefined;
  return v;
}

export function tidyEmail(raw: string | undefined): string | undefined {
  const v = String(raw ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : undefined;
}

/**
 * What to add to the case, given what is on file and what is already there.
 *
 * Returns only the fields that are genuinely new, so a caller can skip the write
 * entirely when there is nothing to add.
 */
export function contactSeed(state: CaseState, known: KnownContact): Record<string, string> {
  const data = (state?.data ?? {}) as Record<string, unknown>;
  const seed: Record<string, string> = {};
  const mobile = tidyMobile(known.mobile);
  const email = tidyEmail(known.email);
  if (mobile && !filled(data, PHONE_KEYS)) seed.contact_phone = mobile;
  if (email && !filled(data, EMAIL_KEYS)) seed.contact_email = email;
  const name = tidyName(known.name);
  if (name && !filled(data, NAME_KEYS)) seed.contact_name = name;
  return seed;
}
