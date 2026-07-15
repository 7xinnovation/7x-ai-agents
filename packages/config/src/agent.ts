import { z } from "zod";
import { LocalizedString, Locale } from "./primitives";
import { Theme } from "./theme";
import { Journey } from "./journey";
import { Integrations } from "./integrations";

/** A supported intent the router can classify a message into. */
export const Intent = z.object({
  key: z.string(),
  description: LocalizedString, // also used to prompt the classifier
  // If set, classifying this intent routes the user into a journey.
  journey: z.string().optional(),
  // Informational intents are answerable without auth (PRD: guests can ask).
  requiresAuth: z.boolean().default(false),
});
export type Intent = z.infer<typeof Intent>;

/**
 * AI safety + accuracy controls (PRD cross-cutting requirement). All values are
 * per-agent so each company can tune grounding strictness independently.
 */
export const Guardrails = z.object({
  // Below this answer-confidence, deflect/escalate instead of guessing.
  confidenceThreshold: z.number().min(0).max(1).default(0.6),
  // PRD AI-governance bands. Intent resolution: ≥proceed act on the intent,
  // between clarify..proceed ask a clarifying question, <clarify request
  // clarification before continuing.
  intentThresholds: z
    .object({ proceed: z.number().min(0).max(1).default(0.85), clarify: z.number().min(0).max(1).default(0.6) })
    .default({ proceed: 0.85, clarify: 0.6 }),
  // PRD AI-governance bands for goal resolution that initiates TRANSACTIONAL
  // journeys: ≥proceed orchestrate, between clarify..proceed ask a clarifying
  // question, <clarify do NOT initiate transactional actions.
  goalThresholds: z
    .object({ proceed: z.number().min(0).max(1).default(0.8), clarify: z.number().min(0).max(1).default(0.6) })
    .default({ proceed: 0.8, clarify: 0.6 }),
  // Topics the agent must refuse and offer escalation for (PRD: refusal set).
  refusalTopics: z.array(z.string()).default([]),
  // If true, licensing/compliance answers must be grounded in the KB; ungrounded
  // answers are suppressed (PRD risk #1).
  requireGroundedAnswers: z.boolean().default(true),
  // Escalation copy shown when deflecting.
  escalationOffer: LocalizedString.optional(),
});
export type Guardrails = z.infer<typeof Guardrails>;

/**
 * The complete, self-contained definition of one embeddable agent. This is the
 * unit the platform "generates": create one row, get a floating widget + full
 * page with its own branding, languages, journeys, knowledge, and integrations.
 */
export const AgentDefinition = z.object({
  // Stable public id used by the embed snippet (data-agent="...").
  slug: z.string(),
  tenantSlug: z.string(),
  name: z.string(),
  // System persona / instructions layered on top of the platform base prompt.
  persona: z.string(),
  // Languages this agent serves; first is the default.
  locales: z.array(Locale).min(1).default(["en"]),
  // Origins allowed to embed this agent (CORS + iframe frame-ancestors).
  allowedOrigins: z.array(z.string()).default([]),
  greeting: LocalizedString,
  theme: Theme,
  // Shown above the document upload slots in the case panel and on the mobile
  // upload page (feedback: state up-front that documents are team-verified and
  // the customer should ensure accurate data for the fastest processing).
  documentsDisclaimer: LocalizedString.optional(),
  // When true, document uploads happen INLINE in the conversation (the agent
  // requests one document at a time and emits an in-chat upload widget), and the
  // case panel's Documents section is suppressed. When false (default) uploads
  // live in the right-side panel. Feedback: keep the upload in the chat.
  documentsInChat: z.boolean().default(false),
  intents: z.array(Intent).default([]),
  journeys: z.array(Journey).default([]),
  guardrails: Guardrails.default({}),
  integrations: Integrations.default({}),
  // Which environment of the agent's API integrations is active (staging vs
  // production). Chosen in the agent's main settings; drives which Swagger
  // baseURL/operations the chat uses.
  activeEnvironment: z.enum(["staging", "production"]).default("production"),
  // Business operating hours drive escalation/support routing (PRD: working-hours
  // routing). Empty = always treated as open. Days: 0=Sun..6=Sat. Times "HH:MM"
  // in the given IANA timezone.
  businessHours: z
    .object({
      timezone: z.string().default("Asia/Dubai"),
      days: z
        .array(z.object({ day: z.number().min(0).max(6), open: z.string(), close: z.string() }))
        .default([]),
    })
    .optional(),
  model: z.string().optional(), // override DIALOG_MODEL per agent
});
export type AgentDefinition = z.infer<typeof AgentDefinition>;
