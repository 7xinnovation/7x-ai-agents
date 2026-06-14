import { z } from "zod";

/**
 * Integration bindings. Each capability is satisfied by a named adapter
 * implementation registered in @dialog/core. Swapping Salesforce for Dynamics,
 * or UAE PASS for another IdP, is a config change (provider + settings), not a
 * code fork. Secrets are referenced by env key, never stored inline.
 */
const AdapterBinding = z.object({
  provider: z.string(), // registry key, e.g. "salesforce", "mock"
  // Non-secret settings (instance url, object names, field mappings...).
  settings: z.record(z.unknown()).default({}),
  // Names of env vars holding secrets for this binding.
  secretRefs: z.array(z.string()).default([]),
});
export type AdapterBinding = z.infer<typeof AdapterBinding>;

export const Integrations = z.object({
  // System of record for cases/applications/renewals/callbacks (PRD: Salesforce).
  crm: AdapterBinding.optional(),
  // Identity provider for authenticated/transactional actions (PRD: UAE PASS).
  auth: AdapterBinding.optional(),
  // Grounding knowledge base for RAG answers.
  knowledge: AdapterBinding.optional(),
  // Document/object storage for uploads.
  storage: AdapterBinding.optional(),
  // Outbound notifications (future: WhatsApp, email).
  notifications: AdapterBinding.optional(),
});
export type Integrations = z.infer<typeof Integrations>;
