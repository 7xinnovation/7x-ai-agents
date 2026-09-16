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
  /**
   * The HOST's own sign-in page.
   *
   * When set, the widget's sign-in button opens THIS page in a popup instead of
   * running our own UAE PASS flow. The host already has a registered UAE PASS
   * client and callback, so the customer signs in on their portal and the token
   * lands in that origin's localStorage. Our embed loader runs first-party on the
   * host page, so a `storage` event from the popup reaches it and it hands the
   * token to the widget, which verifies it server-side before trusting it.
   *
   * This only works where the widget is embedded on the SAME origin as the login
   * (box.emiratespost.ae, app.epgl.ae) -- a different origin gets no storage event
   * and would need the host to postMessage the token to us explicitly.
   *
   * Left unset, sign-in behaves as before and runs our own UAE PASS flow.
   */
  hostLoginUrl: z.string().url().optional(),
  greeting: LocalizedString,
  theme: Theme,
  // Shown above the document upload slots in the case panel and on the mobile
  // upload page (feedback: state up-front that documents are team-verified and
  // the customer should ensure accurate data for the fastest processing).
  documentsDisclaimer: LocalizedString.optional(),
  /**
   * How a customer reaches a human when the assistant cannot pass the request on.
   *
   * It was Emirates Post's 600 599 999, hardcoded, for every agent — so an EPGL
   * licensing submission that failed on 16 September sent the applicant to the PO
   * Box helpline about a postal activity licence. Whoever answers there cannot
   * help with it and should not have been given it.
   *
   * Left unset, the assistant names the entity and no number: an entity that has
   * not given us a contact route is not one we may invent a route to.
   */
  supportContact: z.string().optional(),
  // When true, document uploads happen INLINE in the conversation (the agent
  // requests one document at a time and emits an in-chat upload widget), and the
  // case panel's Documents section is suppressed. When false (default) uploads
  // live in the right-side panel. Feedback: keep the upload in the chat.
  documentsInChat: z.boolean().default(false),
  /**
   * Where the submission-readiness bar and its checklist live.
   *
   * "panel" is how it has always been: in the right-hand case panel, beside the
   * conversation. Emirates Post asked for it ABOVE the chat instead — on a phone
   * the panel is a tab you have to leave the conversation to see, so the one
   * thing telling you how far through you are was the one thing out of sight.
   * That was their request and it was applied to every agent, which moved EPGL's
   * too. It is a per-agent choice now, and the default is what it always was.
   */
  progressPlacement: z.enum(["panel", "top"]).default("panel"),
  /**
   * Whether the case panel carries "What has been done" — the plain-language
   * record of every action taken in the customer's name, with the consent
   * beside each one.
   *
   * Built for EPGL, where a licence application commits the applicant to
   * declarations and a payment and the artefact requires a readable action log.
   * It was rendered for every agent, which put it on the Emirates Post PO Box
   * widget too: a box rental does nothing on anyone's behalf worth a ledger,
   * and an empty "Nothing has been done on your behalf yet" is a question the
   * customer never asked. Off unless an agent is asked for it.
   */
  showActivityLog: z.boolean().default(false),
  /**
   * Hard cap on how many in-chat upload controls one assistant message may show
   * (FB-1565: the next step must be a single, unambiguous ask). The prompt has
   * always told the agent to request one document at a time, but at the opening
   * turn it reliably attaches the whole preparation list's uploads at once, so
   * the customer is handed several boxes before being asked for any of them.
   * Prose alone did not hold; this enforces it at render time.
   *
   * Unset = no cap, which is what agents that legitimately pair blocks need
   * (NXN emits Emirates ID front AND back in one reply by design).
   */
  uploadsPerMessage: z.number().int().positive().optional(),
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
