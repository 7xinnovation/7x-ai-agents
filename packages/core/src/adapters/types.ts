import type { HandoverContext } from "../ai/handover";
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
    input: {
      name: string;
      phone: string;
      email?: string;
      reason: string;
      userRef?: string;
      /**
       * Which journey they were in, for a system of record that routes on it.
       *
       * EPGL's Case has a Type picklist their licensing queue reports on, and a
       * callback about a renewal arriving as a generic question is a callback
       * that goes to the wrong list. The handover context deliberately carries
       * PROSE for a person to read; this is the machine-readable half.
       */
      journeyKey?: string | null;
      /**
       * The journey context that travels WITH the callback — summary, last
       * completed step, consents, payment and the do-not-re-ask list. Without it
       * the officer picks up a name and a sentence and the customer explains
       * everything again. See handoverContext.
       */
      context?: HandoverContext;
      /**
       * What their CRM wants on the case besides a name and a sentence: the
       * case type picklist their queue routes on, and the emirate, PO Box and
       * tracking number an officer would otherwise ring back to ask for. Read
       * from the customer's own words and the journey — see caseIntakeFrom.
       */
      intake?: {
        caseType?: string;
        emirateCode?: string;
        poBoxNumber?: string;
        trackingNumber?: string;
      };
    }
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
/**
 * Which gateway a given payment goes to, and the binding that configures it.
 *
 * Returned by `paymentFor` on the bundle rather than read off `payment`,
 * because from October 2026 an agent may have several: EPGL offers card and
 * UAEPay, and they settle to different places. The binding comes back with the
 * adapter because every call site needs `adapterContext(agent, binding)` and
 * passing the agent's single `integrations.payment` alongside a different
 * adapter is exactly the mismatch this is meant to prevent.
 */
export interface PaymentChoice {
  adapter: PaymentAdapter;
  binding?: import("@dialog/config").AdapterBinding;
  /** The `payment_method` this came from, stored on the payment row. */
  method: string;
}

export interface PaymentAdapter {
  initiate(
    ctx: AdapterContext,
    input: {
      caseId: string;
      amount: number;
      currency: string;
      description: string;
      userRef?: string;
      /**
       * The customer's email, for the gateway's receipt. Separate from userRef
       * on purpose: userRef is an IDENTITY (a UAE PASS sub), and N-Genius
       * rejects a non-address outright — "must be a well-formed email address",
       * HTTP 422, which failed the payment at the very end of the journey.
       */
      email?: string;
      /** Session language, so a hosted checkout page can be shown in it (FB-1445). */
      locale?: string;
      /**
       * Who is paying, where the gateway insists on knowing.
       *
       * N-Genius needs an email and nothing else. UAEPay requires the payer's
       * Emirates ID outright and refuses the payment without it, which is also
       * why UAEPay is offered to signed-in customers only — the Emirates ID
       * comes from their UAE PASS sign-in, not from a question.
       */
      customer?: { name?: string; emiratesId?: string; mobile?: string };
    }
  ): Promise<{ reference: string; link?: string; status: "initiated" | "paid" }>;
  /**
   * `detail` is for the LOG, never for the customer: what the gateway said
   * beyond its verdict — a reason code, a message, the state it is actually in.
   *
   * Added 3 November, after two UAEPay payments on EPGL 2.0 came back failed
   * and there was nothing anywhere to say why. The verdict was recorded, the
   * sentence that explained it was thrown away in the adapter, and answering
   * "ours or theirs?" meant asking the gateway by hand.
   */
  getStatus(
    ctx: AdapterContext,
    input: {
      reference: string;
      /**
       * IS THIS THE LAST WORD, OR IS THE CUSTOMER STILL STANDING THERE?
       *
       * A gateway that reports per ATTEMPT rather than per payment says
       * "failed" of a link the customer can still use. UAEPay does exactly
       * that: on 3 November a first attempt failed, the chat's 2.5-second poll
       * wrote the payment off, and the customer went back into the UAEPay app
       * and paid successfully — AED 1,031.40, their ref S2PXT1911223218145 —
       * against a payment this side had already called dead and would never ask
       * about again.
       *
       * So the live poll and the return page ask WITHOUT this flag: a failed
       * attempt leaves the payment open and the customer can try again in the
       * window that is still in front of them. Only the reconcile sweep, long
       * after the link was made, sets it — and only there can a payment be
       * written off. An adapter whose gateway reports per payment can ignore
       * it entirely.
       */
      final?: boolean;
    }
  ): Promise<{ status: "initiated" | "paid" | "failed"; detail?: string }>;
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
  /**
   * The gateway for a payment made by a particular method, with its binding.
   *
   * Falls back to `payment` for any method that has no binding of its own, so
   * an agent with one gateway behaves exactly as it always has. Undefined only
   * when the agent has no payment gateway at all.
   */
  paymentFor?: (method?: string | null) => PaymentChoice | undefined;
  lookup?: LookupAdapter;
}

export type { CaseState };
