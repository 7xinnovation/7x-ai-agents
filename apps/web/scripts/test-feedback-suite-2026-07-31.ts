/**
 * Deterministic unit checks for the server-side mechanics introduced by the
 * 2026-07-31 feedback round. Definition/prompt assertions live in
 * verify-feedback-2026-07-31.ts; this covers the behaviour that only shows up
 * when the code actually runs.
 *
 * Run from apps/web: npx tsx scripts/test-feedback-suite-2026-07-31.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import type { AgentDefinition, CaseState } from "@dialog/config";
import { emptyCase } from "@dialog/config";
import { dispatchTool, registerMockAdapters, resolveAdapters, transcribeDocumentToText } from "@dialog/core";
import { executeOperation, type EnvSpec } from "../lib/integrations";
import { redactGuestPII } from "../lib/pii";
import type { ApiOperation } from "../lib/openapi";

const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);

/** Minimal chargeable agent with a conditional courier fee (FB-1430). */
const AGENT = {
  slug: "t",
  tenantSlug: "t",
  name: "T",
  persona: "",
  locales: ["en"],
  allowedOrigins: [],
  greeting: { en: "hi" },
  theme: {
    brandName: "T",
    colors: {
      primary: "#000", primaryForeground: "#fff", surface: "#fff", surfaceMuted: "#eee",
      text: "#000", textMuted: "#555", border: "#ccc", success: "#0a0", warning: "#fa0", danger: "#a00",
    },
    radius: "soft",
    fontFamily: "Inter",
    launcher: { position: "bottom-right" },
  },
  documentsInChat: false,
  intents: [],
  journeys: [
    {
      key: "rental",
      intent: "rental",
      title: { en: "Rental" },
      requiresAuth: false,
      steps: [
        {
          key: "s",
          title: { en: "S" },
          requiresAuth: false,
          documents: [],
          fields: [
            { key: "key_delivery", label: { en: "Key delivery" }, type: "text", validation: { required: false } },
            { key: "terms_accepted", label: { en: "Terms" }, type: "boolean", validation: { required: false } },
          ],
        },
      ],
      submission: {
        action: "crm.createCase",
        requiresPayment: true,
        amount: 300,
        currency: "AED",
        surcharges: [
          { key: "key_delivery_fee", label: { en: "Key delivery (courier)" }, amount: 25, when: "key_delivery == 'deliver'" },
        ],
      },
    },
  ],
  guardrails: {
    confidenceThreshold: 0.6,
    intentThresholds: { proceed: 0.85, clarify: 0.6 },
    goalThresholds: { proceed: 0.8, clarify: 0.6 },
    refusalTopics: [],
    requireGroundedAnswers: true,
  },
  integrations: { payment: { provider: "mock", settings: {}, secretRefs: [] }, crm: { provider: "mock", settings: {}, secretRefs: [] } },
  activeEnvironment: "production",
} as unknown as AgentDefinition;

const baseCase = (data: Record<string, unknown>): CaseState => ({
  ...emptyCase(),
  journeyKey: "rental",
  currentStep: "s",
  data: { terms_accepted: true, ...data },
});

const op: ApiOperation = {
  toolName: "probe", method: "GET", path: "/probe", summary: "probe",
  inputSchema: { type: "object", properties: {}, required: [] },
  params: [], hasBody: false, requiresAuth: true,
};

async function main() {
  registerMockAdapters();
  const adapters = resolveAdapters(AGENT);

  // ── FB-1430: the courier fee is actually CHARGED, not just described ──
  {
    const ctx = { agent: AGENT, adapters, authenticated: true, locale: "en", agentId: "a", caseId: "c" };
    const withDelivery = await dispatchTool("request_payment", {}, { ...ctx, state: baseCase({ key_delivery: "deliver" }) } as never);
    check("FB-1430 delivery adds the fee to the charged total", withDelivery.state.payment.amount === 325, `amount=${withDelivery.state.payment.amount}`);
    check("FB-1430 the fee is named back to the model", withDelivery.result.includes("Key delivery (courier) 25 AED"));
    check("FB-1430 the breakdown names the base amount", withDelivery.result.includes("on top of 300 AED"));

    const withPickup = await dispatchTool("request_payment", {}, { ...ctx, state: baseCase({ key_delivery: "branch_pickup" }) } as never);
    check("FB-1430 branch pickup charges the base only", withPickup.state.payment.amount === 300, `amount=${withPickup.state.payment.amount}`);
    check("FB-1430 no breakdown when nothing applies", !withPickup.result.includes("on top of"));

    // A backend-priced journey must still get the add-on on top of the real price.
    const priced = await dispatchTool("request_payment", { amount: 695 }, { ...ctx, state: baseCase({ key_delivery: "deliver" }) } as never);
    check("FB-1430 add-on stacks on an authoritative price", priced.state.payment.amount === 720, `amount=${priced.state.payment.amount}`);
  }

  // ── FB-1445: the checkout link carries the session language ──
  {
    const ctx = { agent: AGENT, adapters, authenticated: true, agentId: "a", caseId: "c" };
    const ar = await dispatchTool("request_payment", {}, { ...ctx, locale: "ar", state: baseCase({}) } as never);
    const link = ar.state.payment.link ?? "";
    check("FB-1445 checkout link carries lang=ar", link.includes("lang=ar"), link);
    const en = await dispatchTool("request_payment", {}, { ...ctx, locale: "en", state: baseCase({}) } as never);
    check("FB-1445 checkout link carries lang=en", (en.state.payment.link ?? "").includes("lang=en"));
  }

  // ── FB-1485: an authenticated customer is never bounced back to sign-in ──
  {
    const res = await dispatchTool(
      "request_authentication",
      { reason: "session expired" },
      { agent: AGENT, adapters, authenticated: true, locale: "en", agentId: "a", caseId: "c", state: baseCase({}) } as never
    );
    check("FB-1485 request_authentication refused when signed in", res.isError === true && res.events.length === 0);
    const guest = await dispatchTool(
      "request_authentication",
      { reason: "need sign in" },
      { agent: AGENT, adapters, authenticated: false, locale: "en", agentId: "a", caseId: "c", state: baseCase({}) } as never
    );
    check("FB-1485 request_authentication still works for a guest", guest.events.some((e) => e.type === "auth_required"));
  }

  // ── FB-1485: a UAE PASS identity token is never used as a backend bearer ──
  {
    // An integration that holds its own service token (uaepass_test) must keep
    // using it, even when a UAE PASS identity token is available. The probe host
    // does not resolve, so the call fails at fetch — what matters is that we did
    // not pre-gate it as "needs sign-in", i.e. a bearer was chosen.
    const spec: EnvSpec = {
      specUrl: "", baseUrl: "http://127.0.0.1:9", authType: "uaepass_test",
      authValue: "service-token", authHeader: null, operations: [],
    };
    const r = await executeOperation(spec, op, {}, undefined, { identityToken: "uaepass-identity", customerAuthenticated: true });
    check("FB-1485 stored service token is used, not the identity token", !r.result.includes("needs the customer to be signed in"), r.result.slice(0, 80));

    // With no stored token and no live passthrough, an authenticated customer gets
    // the "backend unavailable" wording — never "sign in again".
    const bare: EnvSpec = { ...spec, authValue: null };
    const r2 = await executeOperation(bare, op, {}, undefined, { customerAuthenticated: true });
    check("FB-1485 authenticated + no session → no re-sign-in ask", r2.result.includes("do NOT ask them to sign in again"));
    const r3 = await executeOperation(bare, op, {}, undefined, { customerAuthenticated: false });
    check("FB-1485 guest + no session → sign-in guidance kept", r3.result.includes("needs the customer to be signed in"));
  }

  // ── FB-1323: the holder name reaches the model masked, in the asked shape ──
  {
    const body = JSON.stringify({ payload: { customerName: "Mohammed Ali Alhabib", email: "m.ali@example.com", mobile: "0501234567" } });
    const red = JSON.parse(redactGuestPII(body));
    check("FB-1323 holder name masked with asterisks", red.payload.customerName === "M******* A** ******b", red.payload.customerName);
    check("FB-1323 no bullet characters leak through", !redactGuestPII(body).includes("•"));
    check("FB-1323 email masked", red.payload.email === "m***@e***");
    check("FB-1323 mobile keeps only the last 3 digits", red.payload.mobile === "*******567", red.payload.mobile);
  }

  // ── FB-1508: KB import reads text, and refuses what it cannot read ──
  {
    const txt = await transcribeDocumentToText({
      fileName: "policy.md",
      contentType: "text/markdown",
      bytes: new TextEncoder().encode("# Renewal\n\nA PO Box renews for one year.\n"),
    });
    check("FB-1508 markdown import returns its text", (txt.text ?? "").includes("renews for one year"));

    const empty = await transcribeDocumentToText({ fileName: "empty.txt", contentType: "text/plain", bytes: new Uint8Array() });
    check("FB-1508 empty file rejected", empty.error === "empty_file");

    const docx = await transcribeDocumentToText({ fileName: "policy.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: new Uint8Array([1, 2, 3]) });
    check("FB-1508 Word file rejected with a clear reason", docx.error === "unsupported_word_document");

    const zip = await transcribeDocumentToText({ fileName: "archive.zip", contentType: "application/zip", bytes: new Uint8Array([1, 2, 3]) });
    check("FB-1508 unsupported type rejected", zip.error === "unsupported_file_type");
  }

  let fail = 0;
  for (const [name, ok, detail] of results) {
    console.log(` ${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
    if (!ok) fail++;
  }
  console.log(`\n${results.length - fail}/${results.length} checks passed.`);
  if (fail) throw new Error(`${fail} check(s) failed`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
