import { z } from "zod";
import { LocalizedString } from "./primitives";
import { FieldDef } from "./fields";
import { DocumentRequirement } from "./documents";

/**
 * A Journey is a declarative, multi-step flow the agent guides a user through
 * (new license application, renewal, status inquiry...). It drives both the
 * conversation orchestration and the realtime case-builder panel. Adding a
 * journey for a new company is pure config.
 */
export const JourneyStep = z.object({
  key: z.string(),
  title: LocalizedString,
  description: LocalizedString.optional(),
  // Fields collected in this step (validated as captured).
  fields: z.array(FieldDef).default([]),
  // Documents requested in this step.
  documents: z.array(DocumentRequirement).default([]),
  // Whether reaching this step requires an authenticated user (PRD: transactional
  // actions require auth; informational steps do not).
  requiresAuth: z.boolean().default(false),
});
export type JourneyStep = z.infer<typeof JourneyStep>;

export const Journey = z.object({
  key: z.string(),
  // The intent that routes into this journey.
  intent: z.string(),
  title: LocalizedString,
  summary: LocalizedString.optional(),
  requiresAuth: z.boolean().default(true),
  steps: z.array(JourneyStep).default([]),
  // Submission readiness: all mandatory fields/documents present before submit
  // is enabled (PRD: submission blocked until requirements met).
  submission: z
    .object({
      // Adapter action key invoked on submit (e.g. "crm.createCase").
      action: z.string(),
      // Localized label for the readiness checklist heading.
      readinessTitle: LocalizedString.optional(),
    })
    .optional(),
});
export type Journey = z.infer<typeof Journey>;
