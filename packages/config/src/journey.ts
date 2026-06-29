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
      // Chargeable journeys require a confirmed payment before submission
      // (PRD: only confirmed payments trigger service completion).
      requiresPayment: z.boolean().default(false),
      // Fixed amount + currency for the journey (real pricing comes from backend;
      // this is the conversational summary figure / fallback only).
      amount: z.number().optional(),
      currency: z.string().default("AED"),
      // When present, the journey is completed END-TO-END through connected API
      // integration tools (authoritative pricing, order creation on the real
      // payment gateway, and payment confirmation) instead of the internal mock
      // payment + CRM spine. Each phase names the integration tool the agent
      // must call; prompt.ts renders explicit step-by-step guidance and the
      // generic request_payment/submit_case guidance is suppressed.
      apiFlow: z
        .object({
          // Human label for the backing system, used in guidance text.
          service: z.string().optional(),
          // Tool that fetches the record + the inputs pricing/save need.
          detailsTool: z.string().optional(),
          // Tool returning the authoritative price to quote.
          pricingTool: z.string().optional(),
          // Tool that creates the order and returns the gateway payment URL +
          // reference number. When omitted, the journey shows real details +
          // pricing and then completes through the internal payment spine
          // (reliable across turns) — used while a backend write is unavailable.
          saveTool: z.string().optional(),
          // Tool that verifies/confirms the payment after the customer pays.
          confirmTool: z.string().optional(),
          // Default return URL passed to the gateway (paymentReturnUrl).
          paymentReturnUrl: z.string().optional(),
          // If the saveTool fails (e.g. a backend that isn't fully provisioned in
          // staging), fall back to the internal payment so the flow still
          // completes — using the authoritative amount already obtained from the
          // pricing tool. Lets a demo finish end-to-end while the real write is
          // pending; remove once the backend write is live.
          fallbackToInternalPayment: z.boolean().default(false),
          // Free-text field-mapping hints appended to the rendered flow.
          notes: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});
export type Journey = z.infer<typeof Journey>;
