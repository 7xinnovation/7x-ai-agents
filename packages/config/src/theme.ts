import { z } from "zod";

/**
 * Per-agent visual identity. Drives both the floating launcher and the
 * full-page split-screen. Kept intentionally small and token-like so a new
 * company can be themed without touching code (PRD: government-grade, restrained,
 * trust-building; specific brand colors per company).
 */
export const Theme = z.object({
  brandName: z.string(),
  logoUrl: z.string().url().optional(),
  // Core palette — applied as CSS custom properties inside the iframe.
  colors: z.object({
    primary: z.string().default("#1330F0"),
    primaryForeground: z.string().default("#FFFFFF"),
    surface: z.string().default("#FFFFFF"),
    surfaceMuted: z.string().default("#F4F6FB"),
    text: z.string().default("#0B1020"),
    textMuted: z.string().default("#5B6478"),
    border: z.string().default("#E2E6F0"),
    success: z.string().default("#0F9D58"),
    warning: z.string().default("#E8A100"),
    danger: z.string().default("#D23F31"),
  }),
  radius: z.enum(["sharp", "soft", "round"]).default("soft"),
  fontFamily: z.string().default("Inter, system-ui, sans-serif"),
  // Floating launcher placement on the host site.
  launcher: z.object({
    position: z.enum(["bottom-right", "bottom-left"]).default("bottom-right"),
    label: z.string().optional(),
  }),
});
export type Theme = z.infer<typeof Theme>;
