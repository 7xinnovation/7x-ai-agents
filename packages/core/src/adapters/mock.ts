import {
  registerAdapter,
} from "./registry";
import type {
  CRMAdapter,
  AuthAdapter,
  KBAdapter,
  StorageAdapter,
  KBResult,
} from "./types";

/**
 * Mock adapters so the whole platform runs end-to-end before real integrations
 * are wired. They are deterministic and side-effect free. Real providers
 * (salesforce, uaepass, neon-kb, s3) register themselves the same way.
 */

let counter = 1000;
const ref = (prefix: string) => `${prefix}-${++counter}`;

const mockCrm: CRMAdapter = {
  async createCase(_ctx, input) {
    return { reference: ref(input.journeyKey.toUpperCase().slice(0, 3)) };
  },
  async getStatus(_ctx, input) {
    if (!input.reference) return null;
    return { status: "Under Review", missing: [], nextSteps: ["EPGL is reviewing your submission."] };
  },
  async createCallback() {
    return { reference: ref("CB") };
  },
  async findDuplicate() {
    return null;
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

const mockStorage: StorageAdapter = {
  async put(_ctx, input) {
    return { storageKey: `mock://${input.caseId}/${input.key}/${input.fileName}` };
  },
};

export function registerMockAdapters() {
  registerAdapter("crm", "mock", () => mockCrm);
  registerAdapter("auth", "mock", () => mockAuth);
  registerAdapter("knowledge", "mock", () => mockKb);
  registerAdapter("storage", "mock", () => mockStorage);
}
