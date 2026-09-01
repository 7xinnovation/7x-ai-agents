import { z } from "zod";

/**
 * Per-agent visual identity. Drives both the floating launcher and the
 * full-page split-screen. Kept intentionally small and token-like so a new
 * company can be themed without touching code (PRD: government-grade, restrained,
 * trust-building; specific brand colors per company).
 */
export const Theme = z.object({
  brandName: z.string(),
  // Absolute URL or app-relative path (e.g. "/nxn-logo.svg").
  logoUrl: z.string().optional(),
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
  // Optional per-agent typography. headingFont is used for the brand name and
  // section titles; bodyFont for everything else. Both fall back to fontFamily.
  // The CSS family name must match an @font-face declaration in the embed CSS
  // (self-hosted) or a websafe/system family.
  headingFont: z.string().optional(),
  bodyFont: z.string().optional(),
  // Floating launcher placement on the host site.
  launcher: z.object({
    position: z.enum(["bottom-right", "bottom-left"]).default("bottom-right"),
    /**
     * Distance from the bottom and from the side, in pixels.
     *
     * Host pages already have things in that corner — emiratespost.ae has an
     * accessibility button and another chat bubble stacked above ours — and
     * moving out of their way should not require the host to edit their page.
     */
    offsetBottom: z.number().min(0).max(400).optional(),
    offsetSide: z.number().min(0).max(400).optional(),
    label: z.string().optional(),
  }),
});
export type Theme = z.infer<typeof Theme>;
