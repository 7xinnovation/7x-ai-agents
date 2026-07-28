/**
 * Deterministic verification suite for BOTH 2026-07-28 feedback exports:
 *   NXN Round-2 (FB-1374..FB-1433) and EPGL Round-1-Internal (FB-1267..FB-1455).
 * Unit-tests the server-side mechanics that the feedback items rely on —
 * definition/prompt checks live in verify-nxn-round2.ts / verify-epgl-round1-internal.ts,
 * and the interactive flows are exercised live against a running server.
 *
 * Run from apps/web: npx tsx scripts/test-feedback-suite.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import type { AgentDefinition, CaseState } from "@dialog/config";
import {
  dispatchTool,
  submissionReference,
  registerMockAdapters,
  resolveAdapters,
  adapterContext,
  type AdapterBundle,
} from "@dialog/core";
import { simulateNxnMockOp, MOCK_PERSONA_CONTACT, mockPersonaContext } from "../lib/mockPersona";
import { sendEmail } from "../lib/email";
import { notifyOpsForSubmission } from "../lib/opsNotify";

const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);

// ── Minimal agent + state builders for dispatchTool tests ──
const L = (en: string) => ({ en });
function miniAgent(): AgentDefinition {
  return {
    slug: "t",
    tenantSlug: "t",
    name: "T",
    persona: "",
    locales: ["en"],
    allowedOrigins: [],
    greeting: L("hi"),
    theme: {
      colors: {
        primary: "#000", primaryForeground: "#fff", surface: "#fff", surfaceMuted: "#eee",
        text: "#000", textMuted: "#555", border: "#ddd", success: "#0a0", warning: "#aa0", danger: "#a00",
      },
      radius: "soft", fontFamily: "x", launcher: { label: "x", position: "bottom-right" },
    },
    documentsInChat: false,
    intents: [],
    journeys: [
      {
        key: "j1",
        intent: "i1",
        title: L("J1"),
        requiresAuth: false,
        guidance: undefined,
        steps: [
          {
            key: "s1",
            title: L("S1"),
            fields: [
              { key: "name", type: "text", label: L("Name"), validation: { required: true } },
              { key: "terms_accepted", type: "boolean", label: L("Terms"), validation: { required: false } },
            ],
            documents: [
              { key: "doc1", label: L("Doc 1"), requirement: "optional", acceptedFormats: ["pdf"], maxSizeMb: 5 },
            ],
            requiresAuth: false,
          },
        ],
        submission: { action: "crm.createCase", requiresPayment: true, amount: 100, currency: "AED" },
      },
    ],
    guardrails: {
      confidenceThreshold: 0.6,
      intentThresholds: { proceed: 0.85, clarify: 0.6 },
      goalThresholds: { proceed: 0.8, clarify: 0.6 },
      refusalTopics: [],
      requireGroundedAnswers: false,
    },
    integrations: {} as AgentDefinition["integrations"],
    activeEnvironment: "production",
  } as AgentDefinition;
}
function stateFor(agent: AgentDefinition, data: Record<string, unknown>, opts: Partial<CaseState> = {}): CaseState {
  return {
    journeyKey: "j1",
    currentStep: "s1",
    data,
    documents: [],
    payment: { status: "none", reference: null, link: null, amount: null, currency: null },
    readiness: { complete: false, missing: [] },
    status: "draft",
    reference: null,
    ...opts,
  } as CaseState;
}

async function main() {
  // ════ FB-1427 (NXN): expired-box mock renewal details + grace pricing ════
  {
    const det = simulateNxnMockOp("nxnstaging__get_api_Guest_Renewal_Details", { BoxNumber: "33417" });
    const ok = Boolean(det && det.result.includes("2026-02-03T00:00:00"));
    check("FB-1427 mock details returns box 33417's real (expired) date", ok, det?.result.slice(0, 120));
    const active = simulateNxnMockOp("nxnstaging__get_api_Guest_Renewal_Details", { BoxNumber: "50500" });
    check("FB-1427 mock details returns box 50500's active date", Boolean(active?.result.includes("2026-08-19T00:00:00")));
    const price = simulateNxnMockOp("nxnstaging__post_api_Guest_Renewal_Pricing", {
      body: { newBundleId: "MYBOX1", expiryDate: "2027-12-31T00:00:00" },
    });
    const parsed = JSON.parse((price?.result ?? "").split("\n").slice(1).join("\n"));
    check("FB-1427 grace pricing: expired box, 1yr → AED 300 (1 year)", parsed.numberOfYears === 1 && parsed.totalPrice === 300, JSON.stringify(parsed).slice(0, 120));
  }

  // ════ FB-1374/1395/1376 (NXN): persona carries contact + usual branch ════
  {
    const ctx = mockPersonaContext();
    check("FB-1374/1395 persona context has profile contact + never-retype rule",
      ctx.includes(MOCK_PERSONA_CONTACT.mobile) && ctx.includes(MOCK_PERSONA_CONTACT.email) && /NEVER ask them to type/i.test(ctx));
    check("FB-1376 persona context has usual branch + never pre-select", /Usual branch/.test(ctx) && /never pre-select/.test(ctx));
  }

  // ════ FB-1426 (both): email sender is honest when unconfigured ════
  {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_WEBHOOK_URL;
    const res = await sendEmail({ to: "customer@example.com", subject: "x", text: "y" });
    check("FB-1426 sendEmail unconfigured → ok:false email_not_configured", !res.ok && res.reason === "email_not_configured");
    const bad = await sendEmail({ to: "not-an-email", subject: "x", text: "y" });
    check("FB-1426 sendEmail invalid recipient → ok:false", !bad.ok && (bad.reason ?? "").startsWith("invalid_recipient"));
  }

  // ════ FB-1391/1392 (NXN): ops notifications fire for the right submissions ════
  {
    delete process.env.NXN_BRANCH_OPS_EMAIL;
    delete process.env.NXN_EMX_TEAM_EMAIL;
    const out = await notifyOpsForSubmission({
      reference: "REF-1",
      journeyKey: "personal_po_box_rental",
      data: { key_delivery: "deliver", package: "MYHOME", box_number: "50500", delivery_address: "Villa 5, Al Barsha" },
      agentName: "NXN Dialog",
    });
    const kd = out.find((o) => o.kind === "key_delivery");
    const hd = out.find((o) => o.kind === "home_delivery");
    check("FB-1391 key delivery → branch notification with courier tracking ref", kd?.trackingRef === "KD-REF-1" && kd?.result.ok === false && kd.result.reason === "recipient_not_configured");
    check("FB-1392 MyHome → EMX notification queued", Boolean(hd) && hd!.result.ok === false && hd!.result.reason === "recipient_not_configured");
    const none = await notifyOpsForSubmission({ reference: "R", journeyKey: "x", data: { key_delivery: "branch_pickup", package: "MYBOX" }, agentName: "NXN" });
    check("FB-1391/1392 no notification for branch pickup + non-MyHome", none.length === 0);
  }

  // ════ FB-1431 (NXN): request_payment refuses without terms_accepted ════
  {
    const agent = miniAgent();
    const adapters: AdapterBundle = {
      payment: { initiate: async () => ({ reference: "PAY-T", link: "l", status: "initiated" as const }), getStatus: async () => ({ status: "initiated" as const }) },
    } as AdapterBundle;
    const blocked = await dispatchTool("request_payment", {}, {
      agent, state: stateFor(agent, { name: "A" }), adapters, authenticated: true, locale: "en", agentId: "a", caseId: "c",
    });
    check("FB-1431 payment BLOCKED without terms_accepted", blocked.isError === true && /PAYMENT BLOCKED/.test(blocked.result));
    const allowed = await dispatchTool("request_payment", {}, {
      agent, state: stateFor(agent, { name: "A", terms_accepted: true }), adapters, authenticated: true, locale: "en", agentId: "a", caseId: "c",
    });
    check("FB-1431 payment proceeds after terms_accepted", !allowed.isError && /initiated/.test(allowed.result));
  }

  // ════ FB-1401 (NXN) / FB-1326 (EPGL): submit_case attaches uploaded docs ════
  {
    const agent = miniAgent();
    agent.journeys[0]!.submission = { action: "crm.createCase", requiresPayment: false, currency: "AED" } as never;
    let captured: Record<string, unknown> | null = null;
    const adapters: AdapterBundle = {
      crm: {
        createCase: async (_c: unknown, input: { data: Record<string, unknown> }) => { captured = input.data; return { reference: "CASE-1" }; },
        getStatus: async () => null,
        createCallback: async () => ({ reference: "CB-1" }),
      } as never,
    } as AdapterBundle;
    const state = stateFor(agent, { name: "A" }, {
      documents: [{ key: "doc1", status: "uploaded", fileName: "tl.pdf" }],
      readiness: { complete: true, missing: [] },
      status: "ready",
    });
    const res = await dispatchTool("submit_case", {}, { agent, state, adapters, authenticated: true, locale: "en", agentId: "a", caseId: "c" });
    const docs = (captured as { _documents?: { key: string; fileName: string }[] } | null)?._documents;
    check("FB-1401/1326 submit_case payload carries _documents", /Submitted/.test(res.result) && docs?.length === 1 && docs[0]!.fileName === "tl.pdf");
  }

  // ════ FB-1444 (EPGL): submission reference prefers the License Request ════
  {
    const composite = JSON.stringify({
      compositeResponse: [
        { body: { id: "001AAAAAAAAAAAAAAA", success: true }, referenceId: "NewAccount" },
        { body: { id: "003BBBBBBBBBBBBBBB", success: true }, referenceId: "NewContact" },
        { body: { id: "a0XCCCCCCCCCCCCCCC", success: true }, referenceId: "NewLicenseRequest" },
      ],
    });
    check("FB-1444 reference = License Request id, not Account", submissionReference(composite) === "a0XCCCCCCCCCCCCCCC");
    check("FB-1444 rollback → no reference", submissionReference('{"success": false, "message": "Rolled back due to allOrNone=true"}') === null);
  }

  // ════ FB-1326/1402 (EPGL): storage retains bytes for the SF push ════
  {
    registerMockAdapters();
    const def = miniAgent();
    (def.integrations as Record<string, unknown>).storage = { provider: "mock", settings: {}, secretRefs: [] };
    const bundle = resolveAdapters(def);
    const sctx = adapterContext(def, (def.integrations as { storage: never }).storage);
    const bytes = new TextEncoder().encode("PDFDATA");
    const { storageKey } = await bundle.storage!.put(sctx, { caseId: "c1", key: "doc1", fileName: "tl.pdf", bytes, contentType: "application/pdf" });
    const back = await bundle.storage!.get?.(sctx, { storageKey });
    check("FB-1326/1402 storage put→get roundtrip (bytes for SF push)", Boolean(back) && new TextDecoder().decode(back!.bytes) === "PDFDATA" && back!.contentType === "application/pdf");
  }

  // ── Report ──
  let fail = 0;
  for (const [name, ok, detail] of results) {
    console.log(` ${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n         ${detail}` : ""}`);
    if (!ok) fail++;
  }
  console.log(fail ? `\n${fail}/${results.length} FAILED` : `\nAll ${results.length} checks passed.`);
  if (fail) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
