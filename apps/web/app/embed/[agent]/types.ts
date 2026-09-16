import type { LocalizedString, Theme, Locale } from "@dialog/config";

export interface PublicField {
  key: string;
  label: LocalizedString;
  required: boolean;
  type?: string;
  // Required only while this holds — the trade licence number is not asked of a
  // company that has an initial approval and no licence yet.
  condition?: string;
  // Whether the customer may correct this value from the case panel (FB-1566).
  // Undefined on every field of a journey means "not curated" — the panel then
  // falls back to making all text-like fields editable, as it always did.
  editable?: boolean;
}
export interface PublicDocument {
  key: string;
  label: LocalizedString;
  requirement: "mandatory" | "conditional" | "optional";
  // Only requested when this expression holds against the collected case data
  // (same tiny grammar as the engine's evalCondition).
  condition?: string;
  acceptedFormats: string[];
  maxSizeMb: number;
}
export interface PublicStep {
  key: string;
  title: LocalizedString;
  fields: PublicField[];
  documents: PublicDocument[];
}
export interface PublicJourney {
  key: string;
  title: LocalizedString;
  steps: PublicStep[];
}
export interface PublicAgent {
  slug: string;
  name: string;
  locales: Locale[];
  greeting: LocalizedString;
  theme: Theme;
  // Disclaimer shown above the document upload slots (team-verified notice).
  documentsDisclaimer?: LocalizedString;
  // Uploads happen inline in the chat (panel Documents section suppressed).
  documentsInChat?: boolean;
  // Where the readiness bar lives: the case panel (default) or above the chat.
  // Emirates Post asked for theirs above the chat; nobody else did.
  progressPlacement?: "panel" | "top";
  // Cap on upload controls shown per assistant message (FB-1565).
  uploadsPerMessage?: number;
  // Whether the case panel shows the "What has been done" action log. EPGL's
  // artefact asks for it; a PO Box rental has no ledger worth showing.
  showActivityLog?: boolean;
  journeys: PublicJourney[];
  // Origins permitted to embed this agent. Also the allow-list for the host
  // handoff: a postMessage carrying a session token is only read when it comes
  // from one of these. Empty means no host may hand us a token.
  allowedOrigins?: string[];
  // The host portal's own sign-in page. When set, the sign-in button opens it in a
  // popup and we wait for the host's token rather than running our own UAE PASS
  // flow. See hostLoginUrl in packages/config/src/agent.ts.
  hostLoginUrl?: string;
  // Whether real UAE PASS sign-in is configured (vs the dev mock auth toggle).
  uaePassEnabled?: boolean;
  // Whether GPT Realtime voice mode is configured (AZURE_REALTIME_* env present).
  voiceEnabled?: boolean;
}
