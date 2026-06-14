import { z } from "zod";

/**
 * A bilingual string. The platform is Arabic + English first-class (PRD: parity
 * + RTL), so every user-facing label is localized. Additional locales can be
 * added later without schema changes.
 */
export const LocalizedString = z.object({
  en: z.string(),
  ar: z.string().optional(),
});
export type LocalizedString = z.infer<typeof LocalizedString>;

export const Locale = z.enum(["en", "ar"]);
export type Locale = z.infer<typeof Locale>;

/** Resolve a localized string for a locale, falling back to English. */
export function tr(value: LocalizedString | undefined, locale: Locale): string {
  if (!value) return "";
  return (locale === "ar" ? value.ar : value.en) ?? value.en;
}
