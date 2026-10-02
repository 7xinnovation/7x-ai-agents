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
  // Payment gateway for chargeable services (e.g. Network International).
  payment: AdapterBinding.optional(),
  /**
   * MORE THAN ONE GATEWAY, CHOSEN BY THE CUSTOMER (2026-10-02).
   *
   * `payment` above binds ONE gateway per agent, decided at configuration time.
   * EPGL now offers three ways to pay — card, Virtual IBAN, and UAEPay — and
   * two of those are gateways that settle differently and must be asked about
   * different payments. A binding per agent cannot express that.
   *
   * So: keyed by the value the journey records in `payment_method`. A payment
   * whose method matches a key here goes to that gateway; everything else falls
   * back to `payment`, which is why existing agents need no change at all.
   *
   * The key is the METHOD, not the provider name, because the method is what
   * the customer chose and what the surcharge conditions already key on. Two
   * methods may well point at one provider with different settlement settings.
   */
  paymentMethods: z.record(AdapterBinding).optional(),
  // Read-only lookups into backend systems (e.g. shipment tracking).
  lookup: AdapterBinding.optional(),
});
export type Integrations = z.infer<typeof Integrations>;
