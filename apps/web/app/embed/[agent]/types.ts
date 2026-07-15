import type { LocalizedString, Theme, Locale } from "@dialog/config";

export interface PublicField {
  key: string;
  label: LocalizedString;
  required: boolean;
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
  journeys: PublicJourney[];
  // Whether real UAE PASS sign-in is configured (vs the dev mock auth toggle).
  uaePassEnabled?: boolean;
}
