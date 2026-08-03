import type { CaseState } from "@dialog/config";

/**
 * Integration adapter interfaces. Every company-specific system is reached
 * through one of these, so the runtime never depends on a concrete vendor.
 * Register implementations in the registry keyed by provider name; bind them
 * per agent via the AgentDefinition.integrations config.
 */

export interface AdapterContext {
  agentSlug: string;
  settings: Record<string, unknown>;
  secrets: Record<string, string | undefined>;
}

/** System of record for cases/applications/renewals/callbacks (e.g. Salesforce). */
export interface CRMAdapter {
  /** Create a case/application from the assembled case state. Returns a reference. */
  createCase(
    ctx: AdapterContext,
    input: { journeyKey: string; data: Record<string, unknown>; userRef?: string }
  ): Promise<{ reference: string }>;
  /** Look up status for an authenticated user's request. */
  getStatus(
    ctx: AdapterContext,
    input: { reference?: string; userRef: string }
  ): Promise<{ status: string; missing: string[]; nextSteps: string[] } | null>;
  /** Create a human callback request. */
  createCallback(
    ctx: AdapterContext,
    input: { name: string; phone: string; email?: string; reason: string; userRef?: string }
  ): Promise<{ reference: string }>;
  /** Detect an existing active request for the same entity (duplicate guard). */
  findDuplicate?(
    ctx: AdapterContext,
    input: { journeyKey: string; data: Record<string, unknown> }
  ): Promise<{ reference: string } | null>;
  /**
   * Fetch data already held about the customer to pre-fill a journey (PRD: do not
   * re-ask for information the system already holds — e.g. renewals). Returns a
   * flat record of field values keyed by the source name in field.prefillFrom.
   */
  getRecord?(
    ctx: AdapterContext,
    input: { journeyKey: string; userRef: string }
  ): Promise<Record<string, unknown> | null>;
}

/** Identity provider (e.g. UAE PASS). The platform never mints its own identity. */
export interface AuthAdapter {
  /** Build the URL the user is redirected to for sign-in. */
  getAuthorizationUrl(ctx: AdapterContext, input: { returnTo: string; state: string }): string;
  /** Exchange a callback code for a verified identity + company association. */
  exchangeCode(
    ctx: AdapterContext,
    input: { code: string }
  ): Promise<{ userRef: string; name?: string; company?: string }>;
}

export interface KBResult {
  content: string;
  source: string;
  score: number;
}

/** Grounding knowledge base for RAG answers. */
export interface KBAdapter {
  search(
    ctx: AdapterContext,
    input: { agentId: string; query: string; locale: string; limit?: number }
  ): Promise<KBResult[]>;
}

/** Document/object storage for uploads. */
export interface StorageAdapter {
  put(
    ctx: AdapterContext,
    input: { caseId: string; key: string; fileName: string; bytes: Uint8Array; contentType: string }
  ): Promise<{ storageKey: string }>;
  /** Retrieve previously-stored bytes (e.g. to forward uploaded documents to the
   *  system of record after submission — feedback FB-1326/FB-1402). Optional:
   *  adapters that cannot read back return undefined/null. */
  get?(ctx: AdapterContext, input: { storageKey: string }): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

/** Outbound notifications (future channels: WhatsApp, email). */
export interface NotificationAdapter {
  notify(ctx: AdapterContext, input: { to: string; template: string; data: Record<string, unknown> }): Promise<void>;
}

/**
 * Payment gateway (e.g. Network International). Dialog never stores card data;
 * it initiates payment (saved method or secure link), then a webhook confirms
 * the outcome. getStatus supports reconciliation/recovery.
 */
export interface PaymentAdapter {
  initiate(
    ctx: AdapterContext,
    input: {
      caseId: string;
      amount: number;
      currency: string;
      description: string;
      userRef?: string;
      /** Session language, so a hosted checkout page can be shown in it (FB-1445). */
      locale?: string;
    }
  ): Promise<{ reference: string; link?: string; status: "initiated" | "paid" }>;
  getStatus(ctx: AdapterContext, input: { reference: string }): Promise<{ status: "initiated" | "paid" | "failed" }>;
}

/**
 * Read-only lookups into backend systems (e.g. shipment tracking). Returns a
 * generic record the agent summarizes; never a source of truth Dialog invents.
 */
export interface LookupAdapter {
  lookup(
    ctx: AdapterContext,
    input: { kind: string; identifier: string; locale: string }
  ): Promise<Record<string, unknown> | null>;
}

export interface AdapterBundle {
  crm?: CRMAdapter;
  auth?: AuthAdapter;
  knowledge?: KBAdapter;
  storage?: StorageAdapter;
  notifications?: NotificationAdapter;
  payment?: PaymentAdapter;
  lookup?: LookupAdapter;
}

export type { CaseState };
