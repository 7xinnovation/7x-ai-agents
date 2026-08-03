import {
  registerAdapter,
} from "./registry";
import type {
  CRMAdapter,
  AuthAdapter,
  KBAdapter,
  StorageAdapter,
  PaymentAdapter,
  LookupAdapter,
  KBResult,
} from "./types";

/**
 * Mock adapters so the whole platform runs end-to-end before real integrations
 * are wired. They are deterministic and side-effect free. Real providers
 * (salesforce, uaepass, neon-kb, s3) register themselves the same way.
 */

// Seed from the current time so references stay unique across server restarts
// (a plain reset-to-1000 counter collides with references already persisted in
// the payments table from earlier runs, which would make a webhook match a
// stale already-paid row instead of the current case).
let counter = Date.now() % 1_000_000;
const ref = (prefix: string) => `${prefix}-${++counter}`;

const mockCrm: CRMAdapter = {
  async createCase(_ctx, input) {
    return { reference: ref(input.journeyKey.toUpperCase().slice(0, 3)) };
  },
  async getStatus(_ctx, input) {
    // Authenticated status lookup — returns a canned in-review record so the
    // get_status tool demonstrates PRD status tracking without a real backend.
    if (!input.reference && !input.userRef) return null;
    return {
      status: input.reference ? "Under Review" : "Submitted — awaiting review",
      missing: [],
      nextSteps: ["Your submission is being reviewed; you'll be notified of the outcome."],
    };
  },
  async createCallback() {
    return { reference: ref("CB") };
  },
  async findDuplicate() {
    return null;
  },
  async getRecord(_ctx, input) {
    // Canned "held" data so renewal journeys can prefill instead of re-asking
    // (PRD: do not re-ask for data already held). Keyed by prefillFrom source.
    if (!input.userRef) return null;
    return {
      license: "EPGL-2023-004821",
      license_number: "EPGL-2023-004821",
      company_name: "Demo Trading LLC",
      company: "Demo Trading LLC",
      po_box_number: "50500",
      trade_license: "CN-1234567",
      emirate: "Dubai",
    };
  },
};

const mockAuth: AuthAdapter = {
  getAuthorizationUrl(_ctx, input) {
    return `/api/auth/mock/callback?state=${encodeURIComponent(input.state)}&returnTo=${encodeURIComponent(input.returnTo)}`;
  },
  async exchangeCode() {
    return { userRef: "mock-user-001", name: "Demo Applicant", company: "Demo Trading LLC" };
  },
};

/**
 * Mock KB: keyword overlap over a static corpus passed through ctx.settings.corpus
 * (array of {content, source}). Lets the orchestrator demonstrate grounding +
 * refusal without an embeddings provider. The production adapter uses pgvector.
 */
const mockKb: KBAdapter = {
  async search(ctx, input): Promise<KBResult[]> {
    const corpus = (ctx.settings.corpus as { content: string; source: string }[]) ?? [];
    const terms = input.query.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    return corpus
      .map((c) => {
        const text = c.content.toLowerCase();
        const score = terms.reduce((s, t) => (text.includes(t) ? s + 1 : s), 0) / (terms.length || 1);
        return { content: c.content, source: c.source, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit ?? 4);
  },
};

// Uploads are retained in memory (bounded) so they can be read back and
// forwarded to the system of record after submission (FB-1326/FB-1402) — a
// process-local stand-in for real object storage.
const MOCK_STORE_MAX = 200;
const mockStore = new Map<string, { bytes: Uint8Array; contentType: string }>();
const mockStorage: StorageAdapter = {
  async put(_ctx, input) {
    const storageKey = `mock://${input.caseId}/${input.key}/${input.fileName}`;
    mockStore.set(storageKey, { bytes: input.bytes, contentType: input.contentType });
    // Bounded: evict the oldest entries once over the cap.
    while (mockStore.size > MOCK_STORE_MAX) {
      const oldest = mockStore.keys().next().value;
      if (oldest === undefined) break;
      mockStore.delete(oldest);
    }
    return { storageKey };
  },
  async get(_ctx, input) {
    return mockStore.get(input.storageKey) ?? null;
  },
};

/**
 * Mock payment gateway: returns a secure-link + "initiated" status. The mock
 * webhook (/api/payments/webhook) flips it to paid/failed, mirroring a real
 * gateway callback so the full payment lifecycle is exercised end to end.
 */
const mockPayment: PaymentAdapter = {
  async initiate(_ctx, input) {
    const reference = ref("PAY");
    const lang = input.locale === "ar" ? "ar" : "en";
    return {
      reference,
      link: `/api/payments/mock-checkout?ref=${reference}&caseId=${input.caseId}&lang=${lang}`,
      status: "initiated",
    };
  },
  async getStatus() {
    return { status: "initiated" };
  },
};

/** Mock read-only lookup: canned shipment records keyed by identifier shape. */
const mockLookup: LookupAdapter = {
  async lookup(_ctx, input) {
    if (input.kind !== "shipment") return null;
    const id = input.identifier.trim().toUpperCase();
    // Deterministic demo states based on the last character.
    const last = id.charCodeAt(id.length - 1) || 0;
    const scenarios = [
      { status: "In Transit", eta: "in 2 days", exception: null },
      { status: "Out for Delivery", eta: "today", exception: null },
      { status: "Delivered", eta: "delivered", exception: null },
      { status: "Exception", eta: "delayed", exception: "Delivery attempt failed: recipient unavailable" },
      { status: "Customs Clearance", eta: "in 3-4 days", exception: "Customs delay" },
    ];
    const s = scenarios[last % scenarios.length]!;
    return {
      tracking: id,
      status: s.status,
      estimatedDelivery: s.eta,
      exception: s.exception,
      history: [
        { event: "Shipment created", at: "3 days ago" },
        { event: "Accepted at facility", at: "2 days ago" },
        { event: s.status, at: "today" },
      ],
    };
  },
};

export function registerMockAdapters() {
  registerAdapter("crm", "mock", () => mockCrm);
  registerAdapter("auth", "mock", () => mockAuth);
  registerAdapter("knowledge", "mock", () => mockKb);
  registerAdapter("storage", "mock", () => mockStorage);
  registerAdapter("payment", "mock", () => mockPayment);
  registerAdapter("lookup", "mock", () => mockLookup);
}
