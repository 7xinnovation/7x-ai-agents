import { NextRequest } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { Locale } from "@dialog/config";
import { resolveAdapters, runTurn, classifyIntent, findJourney, evalCondition, adapterContext } from "@dialog/core";
import { getDb, payments, documents as documentsTable } from "@dialog/db";
import { and, desc, eq } from "drizzle-orm";
import { getAgentBySlug } from "@/lib/agents";
import { ensureAdapters } from "@/lib/registry";
import { getOrCreateSession, appendMessage, saveCase, audit, saveSessionToken, knownCustomerFacts, knownEpglProfile, markAuthenticated } from "@/lib/conversation";
import { epUsersBaseUrl, hostTokenConfigured, introspectEmiratesPostToken, verifyHostToken } from "@/lib/hostToken";
import { sendEmail, textToHtml } from "@/lib/email";
import { notifyOpsForSubmission } from "@/lib/opsNotify";
import { MOCK_PERSONA_SUB, mockPersonaContext } from "@/lib/mockPersona";
import { uaePassMockAllowed } from "@/lib/uaepass";
import { isBusinessOpen } from "@/lib/businessHours";
import { emitEvent } from "@/lib/analytics";
import { normaliseCompanyKey, buildApiTools } from "@/lib/integrations";
import { companyByEmiratesId, companyByTradeLicense, form9ByAccountId } from "@/lib/epglRead";
import { companiesByAuthority, companyByLicence, listIssuingEntities, ownerMatch, poBoxesByEmiratesId, companiesByEmiratesId } from "@/lib/gsbLookup";
import { regionsFor, searchRegions, searchOtherEmirates, EMIRATES } from "@/lib/epRegions";
import { addressFromPin } from "@/lib/epGeocode";
import { payFenceGuard } from "@/lib/payFence";
import { setAutoRenew } from "@/lib/nxnAutoRenew";
import { pulseServiceFor, pulseSurveyToken, pulseIsSandbox } from "@/lib/customerPulse";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
// Multi-tool turns (e.g. a renewal: details + pricing + payment) can run well past
// 60s; allow up to 5 min so the stream isn't cut mid-turn ("connection lost").
export const maxDuration = 300;

const Body = z.object({
  agentSlug: z.string(),
  userMessage: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  locale: Locale.default("en"),
  authenticated: z.boolean().default(false),
  userRef: z.string().optional(),
  // UAE PASS session token forwarded by the embedding site (for uaepass_live auth).
  uaePassToken: z.string().optional(),
  // Proactive "account pulse": fired by the embed right after sign-in. The server
  // substitutes an internal directive (not a visible user message) that has the
  // agent pull the customer's account data and surface what needs attention.
  pulse: z.boolean().optional(),
  // Fired by the embed when the in-chat payment card observes the gateway webhook
  // settle the payment. Like `pulse`, the server substitutes an internal directive
  // (not a visible user message) so the agent confirms and continues the journey.
  paymentSettled: z.boolean().optional(),
  // Fired by the embed after a document is uploaded inline (documents-in-chat
  // flow). The server substitutes a directive so the agent confirms what was
  // captured and requests the NEXT document, one at a time.
  documentUploaded: z.boolean().optional(),
  // TEST-ONLY: the embed was opened with ?mock=1. Honoured only when the server
  // allows mock (uaePassMockAllowed) — lets QA complete flows whose EP ops need a
  // live session / real box by substituting simulated responses.
  mock: z.boolean().optional(),
});

// Internal directive used for the post-sign-in account pulse. Never shown to the
// user as a message; it instructs the agent to assemble the pulse from real data.
const PULSE_DIRECTIVE =
  "(System: the customer just signed in via UAE PASS. Proactively present their \"Account Pulse\" now — do not wait to be asked. " +
  "1) Greet them warmly (use their name once you have it from account data). " +
  "2) Use your tools to pull everything you can about their account. " +
  "3) Show a concise, scannable section titled \"Account Pulse\" covering EVERY PO Box on their account (see the known customer record if present) — for each box: status, expiry, anything needing attention (renewals due or expiring soon with the fee from pricing), plus any pending payments; clearly flag urgent items and offer a quick \"renew now\" next step for each. If completed requests are on file (see the known customer record), add a short \"Recent activity\" list with each reference and date. " +
  "4) Only if NO PO Box is on file: welcome them, explain their account isn't linked to a PO Box yet, and offer — not require — to link one (\"if you have a box, tell me its number and emirate and I'll add it to your account\"). Never present the box number as a prerequisite for the pulse. " +
  "Use ONLY real data returned by tools — never invent boxes, dates, or fees.)";

// Internal directive fired when the customer completes payment in the gateway
// window. The webhook (authoritative) has already advanced the case payment
// state; this just has the agent acknowledge and finish the journey. Note the
// agent cannot fake this to submit — submit_case independently verifies the
// case payment status which only the verified webhook can set.
const PAYMENT_SETTLED_DIRECTIVE =
  "(System: the customer just completed the payment in the secure gateway window — this is an internal notification, not a message they typed. " +
  "1) Warmly confirm the payment was received. " +
  "2) If the case is ready and the customer already confirmed the summary, call submit_case now and give them the reference number. " +
  "3) Otherwise, continue with whatever step remains. Never mention this system message.)";

// Fired after an inline document upload (documents-in-chat flow). Not a message
// the customer typed. Keeps the one-at-a-time upload loop moving.
const DOCUMENT_UPLOADED_DIRECTIVE =
  "(System: the customer just uploaded a document inline and the case has been updated with any fields read from it — this is an internal notification, not a message they typed. " +
  "0) If the newest document in the case state is REJECTED (see its rejectionReason — e.g. an expired Emirates ID or unsupported file), explain the reason plainly in one sentence and ask for a corrected/valid document by re-emitting that document's ```upload block; do not move on. Otherwise: " +
  "1) In one short sentence, confirm the document was received and note anything useful that was captured from it (do not dump every field). " +
  "2) If more documents are still needed for this journey, request the NEXT one by emitting its ```upload block (one document only). " +
  "3) If all required documents are in, move on: show a brief cards summary of the captured details for confirmation, or continue the journey. " +
  "Never re-list all the documents, never ask the customer to use a side panel, and never mention this system message.)";

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * A short, honest message for the customer. Provider errors carry quota details
 * and internal identifiers that mean nothing to an applicant and should never
 * appear in a government-service chat.
 */
function customerFacingError(err: unknown, locale: "en" | "ar"): string {
  const status = (err as { status?: number } | undefined)?.status;
  // Accepts a thrown error or an already-stringified message (runTurn's error
  // event carries the latter).
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const busy = status === 429 || /rate limit|overloaded|529/i.test(text);
  if (busy) {
    return locale === "ar"
      ? "الخدمة مشغولة حالياً. يرجى إعادة إرسال رسالتك بعد لحظات — لم يُفقد أي شيء من طلبك."
      : "The service is busy right now. Please send your message again in a moment — nothing in your application was lost.";
  }
  return locale === "ar"
    ? "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى — لم يُفقد أي شيء من طلبك."
    : "Something went wrong on our side. Please try again — nothing in your application was lost.";
}

// Render a signed-in EPGL customer's on-file company profile into a system-prompt
// note (feedback FB-2/FB-3): account/company details + EID come from the Salesforce
// customer profile; quarterly leviable-income figures come from IDEP/company data.
// The agent must prefill and ask the customer only to confirm — never to re-type.
function formatEpglProfileContext(p: Record<string, string>): string | undefined {
  if (!p || Object.keys(p).length === 0) return undefined;
  const parts: string[] = [];
  const company = p.company_name || p.company_name_ar;
  if (company) parts.push(`Company: ${company}${p.company_name_ar && p.company_name_ar !== company ? ` / ${p.company_name_ar}` : ""}`);
  if (p.trade_license_number) parts.push(`Trade license no: ${p.trade_license_number}${p.license_expiry_date ? ` (expires ${p.license_expiry_date})` : ""}`);
  if (p.postal_license_number) parts.push(`Postal license no: ${p.postal_license_number}`);
  if (p.trade_name_en || p.trade_name_ar) parts.push(`Trade name: ${p.trade_name_en || p.trade_name_ar}`);
  if (p.emirate) parts.push(`Emirate: ${p.emirate}`);
  if (p.address_street) parts.push(`Address: ${p.address_street}`);
  if (p.owner_name) parts.push(`Owner: ${p.owner_name}`);
  if (p.owner_emirates_id) parts.push(`Owner Emirates ID: ${p.owner_emirates_id}`);
  if (p.owner_nationality) parts.push(`Owner nationality: ${p.owner_nationality}`);
  if (p.contact_name || p.contact_email) parts.push(`Contact: ${[p.contact_name, p.contact_email, p.contact_phone].filter(Boolean).join(", ")}`);
  const quarters = ["leviable_income_q1", "leviable_income_q2", "leviable_income_q3", "leviable_income_q4"]
    .map((k, i) => (p[k] ? `Q${i + 1} ${p[k]}` : null))
    .filter(Boolean);
  if (quarters.length) parts.push(`Quarterly leviable income${p.financial_year ? ` for FY ${p.financial_year}` : ""} (from IDEP/company data): ${quarters.join(", ")}`);
  if (p.accountant_name || p.accountant_email) parts.push(`Accountant: ${[p.accountant_name, p.accountant_email, p.accountant_phone].filter(Boolean).join(", ")}`);
  if (parts.length === 0) return undefined;
  return (
    "This signed-in customer's company profile on file (from their Salesforce customer profile and IDEP company data): " +
    parts.join("; ") +
    ". Use these to PREFILL the application via collect_field — the account/company details and Emirates ID come from the customer's profile, and the quarterly leviable-income figures come from IDEP/company data, so do NOT ask the customer to type any of them. Present what you have as a card and ask only for a quick confirmation, plus anything genuinely missing. Before submitting, sanity-check the Emirates ID looks valid (format 784-YYYY-NNNNNNN-N) and flag it if not."
  );
}

/**
 * Streams a conversational turn as SSE. History and case are loaded from the DB
 * (server-authoritative); turns, submissions, payments, and escalations are
 * persisted, audited, and emitted as standardized analytics events.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400 });
  }
  const body = parsed.data;

  const agent = await getAgentBySlug(body.agentSlug);
  if (!agent) return new Response(JSON.stringify({ error: "agent_not_found" }), { status: 404 });

  ensureAdapters();
  const adapters = resolveAdapters(agent.definition);
  const businessOpen = isBusinessOpen(agent.definition);
  const isNewSession = !body.conversationId;

  const session = await getOrCreateSession({
    agentId: agent.id,
    conversationId: body.conversationId,
    locale: body.locale,
    authenticated: body.authenticated,
    userRef: body.userRef,
  });

  // Dynamic tools from the agent's API integrations for the ACTIVE environment.
  // Auth precedence: live UAE PASS passthrough > this conversation's stored session
  // token (e.g. from a prior OTP login) > a freshly-minted token captured this turn.
  // Two distinct kinds of token, never interchangeable (FB-1485): a backend session
  // (OTP-minted for this conversation) is a bearer for protected ops; a UAE PASS
  // identity token proves who the customer is and may only be sent to integrations
  // that declare authType "uaepass_live".
  const uaePassIdentityToken = session.sessionTokenKind === "uaepass" ? session.sessionToken : undefined;
  const backendSessionToken = session.sessionTokenKind === "uaepass" ? undefined : session.sessionToken;

  /**
   * The host handoff: UAE PASS -> emiratespost.ae -> NXN authenticates -> NXN
   * issues a SIGNED token -> the embed posts it here -> we validate it, and only
   * then does it become the customer's identity and the bearer for Emirates
   * Post's protected endpoints.
   *
   * It arrives over postMessage from whatever page framed us, so it is attacker-
   * controlled input until the signature says otherwise. Emirates Post would
   * reject a forged one, but we would already have treated the holder as that
   * customer. Unverified, it is dropped: it never reaches an integration and it
   * never marks a conversation signed in.
   */
  let hostToken: string | undefined;
  let verifiedEmiratesId: string | undefined;
  /** Name and mobile from the same verified introspection, for the survey. */
  let verifiedIdentity: { name?: string; mobile?: string } | undefined;
  if (body.uaePassToken) {
    // Two shapes, decided by what the token IS rather than by configuration:
    // a signed JWS is verified against a key; Emirates Post's identity-service
    // token is opaque, so it is validated by using it (GET /api/v1/Account),
    // which also returns the customer's Emirates ID.
    const looksSigned = body.uaePassToken.split(".").length === 3;
    let sub: string | undefined;
    let reason = "";

    if (looksSigned && hostTokenConfigured()) {
      const v = verifyHostToken(body.uaePassToken);
      if (v.ok) sub = v.claims.sub;
      else reason = v.reason;
    } else {
      const usersBase = await epUsersBaseUrl(agent.id, agent.definition.activeEnvironment ?? "production");
      if (!usersBase) reason = "no Emirates Post users service configured for this environment";
      else {
        const v = await introspectEmiratesPostToken(body.uaePassToken, usersBase);
        if (v.ok) {
          sub = v.identity.sub;
          verifiedEmiratesId = v.identity.emiratesId;
          verifiedIdentity = { name: v.identity.name, mobile: v.identity.mobileNumber };
        } else reason = v.reason;
      }
    }

    if (sub) {
      hostToken = body.uaePassToken;
      // The verified subject is the identity — never the client's `userRef` claim.
      if (!session.authenticated || session.userRef !== sub) {
        await markAuthenticated(session.conversationId, sub);
        session.authenticated = true;
        session.userRef = sub;
      }
    } else {
      log.warn("host_token_rejected", {
        agentId: agent.id,
        conversationId: session.conversationId,
        reason,
        // Distinguishes "NXN sent us something bad" from "we are not set up yet",
        // which look identical from the customer's side and need opposite fixes.
        signed: looksSigned,
        configured: hostTokenConfigured(),
      });
    }
  }
  // Save-before-pay guard (see buildApiTools.blockUnpaidSaves). Collected across
  // every journey rather than just the active one: journeyKey can still be unset
  // at this point in a turn that both starts a journey and runs its tools.
  const paidAlready = session.state.payment?.status === "paid";
  const unpaidSaveTools = paidAlready
    ? []
    : (agent.definition.journeys ?? [])
        // A journey with a confirmTool takes its payment on the BACKEND's gateway:
        // the save is what creates the order and opens the payment, so it has to run
        // before any money moves. Blocking it until paid would deadlock the journey
        // it was written to protect. The gate stays on for internal-checkout
        // journeys, where a save before payment really is a record written too soon.
        .filter((j) => j.submission?.requiresPayment && j.submission?.apiFlow?.saveTool && !j.submission?.apiFlow?.confirmTool)
        .map((j) => j.submission!.apiFlow!.saveTool as string);
  const apiTools = await buildApiTools(agent.id, agent.definition.activeEnvironment ?? "production", {
    blockUnpaidSaves: unpaidSaveTools.length ? { toolSuffixes: unpaidSaveTools, paid: paidAlready } : undefined,
    // So a backend refusal is recoverable afterwards, not only in this turn's context.
    conversationId: session.conversationId,
    // Select and Save land in DIFFERENT TURNS — the reservation is made when the
    // payment is taken, the save happens once the payment settles. buildApiTools is
    // rebuilt per request, so without seeding this the hold is forgotten between
    // the two and every save is refused for having no reservation behind it.
    initialHold: session.state.hold ?? null,
    // The list is shown in one turn and picked from in the next.
    initialOfferedBoxIds: session.state.offeredBoxIds ?? [],
    // The company is looked up turns before the save that has to declare where
    // its details came from.
    gsbCompanies: session.state.gsbCompanies ?? [],
    // Set on the save payload rather than handed to the model, which pasted it
    // into a pay block and sent the customer to our own return page.
    paymentReturnUrl: (agent.definition.journeys ?? [])
      .map((j) => j.submission?.apiFlow?.paymentReturnUrl)
      .find(Boolean),
    // Whose gateway this journey pays on, decided the same way the prompt decides it.
    backendGateway: Boolean(
      (agent.definition.journeys ?? []).find((j) => j.key === session.state.journeyKey)?.submission?.apiFlow?.confirmTool
    ),
    uaePassToken: hostToken ?? uaePassIdentityToken,
    sessionToken: backendSessionToken,
    // Guest sessions get PII-redacted tool results (server-authoritative flag).
    authenticated: session.authenticated,
    // TEST-ONLY: in mock demo mode (server allows it + the embed was opened with
    // ?mock=1, or the signed-in user is the mock persona), simulate the EP ops
    // that can't run without a live session (FreeBoxes) or a real box
    // (Guest/Renewal Details+Pricing), so guest AND signed-in demos complete.
    mockSimulate: uaePassMockAllowed() && (session.userRef === MOCK_PERSONA_SUB || body.mock === true),
  });
  const { tools: allApiTools, exec: execIntegration } = apiTools;
  /**
   * Attaching a file is the server's job, not the model's.
   *
   * The document upload takes the file's BYTES, which the model has never seen —
   * it only knows a name and a key. Offered the tool, it calls it anyway: on 2
   * Sep it tried twice, once with an invented `documents: [...]` array and once
   * with a bare key and filename, and Salesforce answered 400 both times. The
   * real uploads run after the submission, from the stored file, and they
   * succeeded in the same conversation. So the tool stays callable and stops
   * being offered.
   */
  const serverOnlyDocTool = allApiTools.find((t) => /uploaddocument/i.test(t.name))?.name;
  const baseExtraTools = serverOnlyDocTool
    ? allApiTools.filter((t) => t.name !== serverOnlyDocTool)
    : allApiTools;
  // Emirates Post quotes the real total when it issues the hold; that figure
  // outranks the advertised bundle price when the customer is charged.
  const authoritativeAmount = () => apiTools.getLastHold()?.amount ?? null;
  // Emirates Post records a rental against a reservation, so a payment taken
  // before one exists cannot be attached to anything. The journey is read live
  // inside the tool — deciding here would use the turn's opening state, which is
  // blank on the very turn the journey starts.
  const holdBackedSaveTools = ["post_api_Rental_Save"];
  const holdPresent = () => Boolean(apiTools.getLastHold());
  // The company/Form 9 reads are EPGL's Salesforce org; offering them to another
  // tenant's agent would be meaningless (and lib/epglRead would throw).
  const hasEpglSalesforce = agent.definition.tenantSlug === "epgl";

  // Server-authoritative auth (sticky after UAE PASS), not the client's claim.
  const authenticated = session.authenticated;
  const userRef = session.userRef ?? body.userRef;

  // Account pulse runs only for a signed-in customer; otherwise treat as normal.
  // The pulse runs once per case. The client latches it too, but three separate
  // signals report a completed sign-in and a reload re-arms all of them — and a
  // customer having their whole account read back to them twice is worse than
  // missing the second read.
  const alreadyPulsed = Boolean(session.state.pulsedAt);
  const isPulse = Boolean(body.pulse) && authenticated && !alreadyPulsed;
  // A pulse that has already run is not a turn at all: run as an ordinary message
  // it would put the internal directive in the transcript as something the
  // customer said. Answer the stream with nothing and let the client carry on.
  if (Boolean(body.pulse) && authenticated && alreadyPulsed) {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(sse({ type: "session", conversationId: session.conversationId })));
          c.enqueue(enc.encode(sse({ type: "done", state: session.state, message: "" })));
          c.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } }
    );
  }
  const isPaymentSettled = Boolean(body.paymentSettled) && !isPulse;
  const isDocumentUploaded = Boolean(body.documentUploaded) && !isPulse && !isPaymentSettled;

  // Returning customer: boxes we already know from their previous authenticated
  // sessions (current conversation's case included — it's stored per turn).
  // Injected into the system prompt on EVERY authenticated turn, so both the
  // auto-pulse and a typed "show my account" never re-ask for a box number.
  let customerContext: string | undefined;
  let pulseDirective = PULSE_DIRECTIVE;
  if (authenticated && userRef) {
    // EPGL: prefill the signed-in customer's company profile + EID + quarterly
    // figures from their Salesforce/IDEP company data (feedback FB-2/FB-3).
    if (agent.definition.slug === "epgl-dialog") {
      const profile = await knownEpglProfile(agent.id, userRef).catch(() => ({}));
      customerContext = formatEpglProfileContext(profile);
    } else if (userRef === MOCK_PERSONA_SUB) {
      // TEST-ONLY: the mock UAE PASS persona (UAEPASS_MOCK=1) is given a couple of
      // existing PO Boxes so signed-in flows have account data to work with.
      customerContext = mockPersonaContext();
    } else {
      const facts = await knownCustomerFacts(agent.id, userRef).catch(() => null);
      if (facts && (facts.boxes.length || facts.contactPhone || facts.contactEmail || facts.history.length)) {
        const parts: string[] = [];
        if (facts.boxes.length) {
          const list = facts.boxes.map((b) => `${b.box}${b.emirate ? ` (${b.emirate})` : ""}`).join(", ");
          parts.push(
            `PO Box${facts.boxes.length > 1 ? "es" : ""} on file: ${list} — for account questions, status checks, renewals, or the Account Pulse use these immediately (fetch fresh details/pricing from backend tools); do NOT ask for the box number or emirate again.`
          );
        }
        // FB-1376: surface the customer's usual branch as an offer, never a pre-selection.
        if (facts.preferredBranch) {
          parts.push(`Usual branch: ${facts.preferredBranch} — when presenting branches you may highlight it with a badge (e.g. "Your usual branch"), but never pre-select it.`);
        }
        // The Emirates ID Emirates Post returned for this verified session. It is
        // what the GSB ownership check compares against, so surfacing it here is
        // what stops the agent asking for something we were already told — and
        // stops it accepting an Emirates ID the customer typed, which would let
        // anyone claim ownership of any licence.
        if (verifiedEmiratesId) {
          parts.push(
            `Verified Emirates ID for this signed-in customer: ${verifiedEmiratesId} — this came from Emirates Post, not from the customer. Use it as the emiratesId for nxn_company_by_licence when checking whether they own a trade licence, and never ask them to type their Emirates ID for that check.`
          );
        }
        // FB-1374/FB-1395: contact details come from the profile, not re-typed.
        if (facts.contactPhone || facts.contactEmail) {
          parts.push(
            `Contact on file: ${[facts.contactPhone, facts.contactEmail].filter(Boolean).join(", ")} — when a journey needs a contact phone or email, record these with collect_field and ask the customer only to confirm; never ask them to type these again.`
          );
        }
        // FB-1397: completed requests double as the customer's account history.
        if (facts.history.length) {
          parts.push(
            `Completed requests: ${facts.history.map((h) => `${h.reference} (${h.journey}${h.date ? `, ${h.date}` : ""})`).join("; ")} — present these when the customer asks about their history or a previous request.`
          );
        }
        customerContext = `This customer's record from previous sessions: ${parts.join(" ")}`;
      }
    }
    if (customerContext) pulseDirective += ` (${customerContext})`;
  }
  const effectiveMessage = isPulse
    ? pulseDirective
    : isPaymentSettled
      ? PAYMENT_SETTLED_DIRECTIVE
      : isDocumentUploaded
        ? DOCUMENT_UPLOADED_DIRECTIVE
        : body.userMessage;

  const a = { agentId: agent.id, conversationId: session.conversationId };
  const startJourney = session.state.journeyKey;

  // Transactional email as a first-class tool (Round-2 feedback FB-1426: the
  // assistant claimed confirmation emails that were never sent). The tool result
  // is explicit about success vs failure, so the model can only claim "sent"
  // after a real send — and can re-call it to resend.
  const EMAIL_TOOL_NAME = "send_confirmation_email";
  const emailTool: Anthropic.Tool = {
    name: EMAIL_TOOL_NAME,
    description:
      "Send a transactional email to the customer (confirmation, receipt, reference number). Returns SENT or NOT SENT — only tell the customer an email was sent when this tool returns SENT. Call it again to resend if the customer says nothing arrived.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "The customer's email address (from their profile or collected this session)" },
        subject: { type: "string" },
        body: { type: "string", description: "Plain-text email body (include the reference number and key details)" },
      },
      required: ["to", "subject", "body"],
    },
  };
  // Company + Form 9 reads (FB-1268 / FB-1269). Salesforce serves these over the
  // standard SOQL query endpoint; the statements are fixed server-side and the
  // model supplies only a value, so it can never compose a query. See lib/epglRead.
  const COMPANY_TOOL = "epgl_company_lookup";
  const COMPANY_BY_EID_TOOL = "epgl_company_by_emirates_id";
  const FORM9_TOOL = "epgl_form9_history";
  const epglReadTools: Anthropic.Tool[] = hasEpglSalesforce
    ? [
        {
          name: COMPANY_TOOL,
          description:
            "Look up a company already registered with EPGL by its TRADE LICENCE NUMBER. Returns the registered company details (names in English and Arabic, licence number and expiry, emirate, regulator, postal licence number and status) and the contacts on file with their Emirates ID and designation. Use it as soon as you know the trade licence number — from the customer or read off their uploaded licence — and ask the customer to CONFIRM what comes back instead of asking them to type it. Returns no match for a company EPGL has never licensed.",
          input_schema: {
            type: "object",
            properties: {
              tradeLicenseNumber: { type: "string", description: "The trade licence number exactly as printed on the licence" },
            },
            required: ["tradeLicenseNumber"],
          },
        },
        {
          name: COMPANY_BY_EID_TOOL,
          description:
            "Find the companies a signed-in customer is a contact on, using their EMIRATES ID. Use it as soon as they are signed in and you do not yet have a trade licence number — sign-in gives you their Emirates ID, not a licence. Returns every company they are on: one, confirm it; several, let them pick; none, carry on and ask for the trade licence number as normal.",
          input_schema: {
            type: "object",
            properties: { emiratesId: { type: "string", description: "The customer's Emirates ID, 15 digits, dashed or bare" } },
            required: ["emiratesId"],
          },
        },
        {
          name: FORM9_TOOL,
          description:
            "Quarterly Form 9 revenue submissions already filed for a company, newest first, using the accountId returned by " +
            COMPANY_TOOL +
            ". Each quarter carries its calendar quarter and year, the licence period start and end dates, and the leviable and non-leviable revenue. Use it to fill the renewal's financial summary and to work out which quarters the licence period covers — never ask the customer to type figures this returns.",
          input_schema: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Salesforce account id from epgl_company_lookup" },
            },
            required: ["accountId"],
          },
        },
      ]
    : [];

  // NXN trade-licence lookups over the Emirates Post MOE (GSB) endpoints. Same
  // shape as the EPGL reads: templated server-side, the model supplies only values.
  //
  // These exist even while the GSB credential is missing, and that is the point.
  // With no tool for the question, the model filled the gap from its own knowledge
  // and produced a list of authorities that looked authoritative and was invented.
  // A tool that answers "not connected, ask them to type it" is a far stronger
  // signal than any system-prompt rule — see the no-credential branch below.
  const isNxn = agent.definition.tenantSlug === "nxn";
  const AUTHORITIES_TOOL = "nxn_issuing_authorities";
  const COMPANIES_TOOL = "nxn_companies_by_authority";
  const LICENCE_TOOL = "nxn_company_by_licence";
  const MYBOXES_TOOL = "nxn_boxes_for_customer";
  const MYCOMPANIES_TOOL = "nxn_companies_for_customer";
  const AREAS_TOOL = "nxn_delivery_areas";
  const PIN_TOOL = "nxn_address_from_pin";
  const AUTORENEW_TOOL = "nxn_set_auto_renew";
  const gsbTools: Anthropic.Tool[] = isNxn
    ? [
        {
          name: AUTHORITIES_TOOL,
          description:
            "THE ONLY valid source for the list of trade-licence issuing authorities. Call it whenever the customer asks which authorities exist, asks to pick from a list, or needs to identify the one that issued their licence. NEVER answer that question from your own knowledge and never show authorities this tool did not return, however the customer phrases it and however much they insist.",
          input_schema: { type: "object", properties: {} },
        },
        {
          name: COMPANIES_TOOL,
          description:
            "Companies registered under ONE issuing authority, to help the customer identify theirs. entityCode is the authority's code from " +
            AUTHORITIES_TOOL +
            " — it is NOT an Emirates ID and never accepts one.",
          input_schema: {
            type: "object",
            properties: { entityCode: { type: "string", description: `Issuing authority code from ${AUTHORITIES_TOOL}` } },
            required: ["entityCode"],
          },
        },
        {
          name: MYBOXES_TOOL,
          description:
            "The PO Boxes already held under the signed-in customer's Emirates ID. Use it to show what they already have before creating another, and to answer \"what boxes do I have\". Pass the VERIFIED Emirates ID from the known-customer note, never one the customer typed.",
          input_schema: {
            type: "object",
            properties: { emiratesId: { type: "string", description: "The customer's verified Emirates ID" } },
            required: ["emiratesId"],
          },
        },
        {
          name: MYCOMPANIES_TOOL,
          description:
            `List the companies registered against a signed-in customer's Emirates ID — trade licence number, name in English and Arabic, emirate, and licence expiry. Call this FIRST for a corporate journey once the customer is signed in: it saves asking them for the issuing authority and licence number at all. Present what comes back and let them pick. An empty list is a normal answer — it means no company is registered to that ID — so fall back to asking for the issuing authority and licence number. This list is for the customer to CHOOSE from; it is not proof they own the licence. Ownership is still established by ${LICENCE_TOOL}, which is the only call that returns the owners' Emirates IDs.`,
          input_schema: {
            type: "object",
            properties: { emiratesId: { type: "string", description: "The customer's verified Emirates ID" } },
            required: ["emiratesId"],
          },
        },
        {
          name: AREAS_TOOL,
          description:
            "THE ONLY valid source for the areas Emirates Post delivers to. A MyHome or MyHome Instant box goes to the customer's home, and the backend accepts an address only when its area is one of these — a typed-in community or building name is rejected with MYHOME_ADDDRESSNOT_FOUND. Call this as soon as a MyHome customer gives you an address, pass what they said as query, show what comes back as CARDS and let them pick. Then send myHomeProfile.myHomeAddress.regionName as the CODE this returns (e.g. \"DXB-84\"), never the area's name. If nothing matches, ask which district they are in — never choose one for them, because the post is delivered to whatever area is recorded.",
          input_schema: {
            type: "object",
            properties: {
              emirateCode: { type: "string", description: "Three-letter emirate code, e.g. DXB" },
              query: { type: "string", description: "The area or address the customer gave, to narrow the list" },
            },
            required: ["emirateCode"],
          },
        },
        {
          name: PIN_TOOL,
          description:
            "Turn a location the customer pinned on the map into an Emirates Post address. Pass the latitude and longitude from their pinned-location message. This is the BEST way to capture a MyHome delivery address and should be offered FIRST — it returns the emirate, the area, the street and the building as Emirates Post itself records them, so the customer never has to know which district they live in or how it is spelled. It also says whether Emirates Post delivers to that point at all. If it returns a region code, use it directly as myHomeProfile.myHomeAddress.regionName.",
          input_schema: {
            type: "object",
            properties: {
              latitude: { type: "number", description: "Latitude from the pinned location" },
              longitude: { type: "number", description: "Longitude from the pinned location" },
            },
            required: ["latitude", "longitude"],
          },
        },
        {
          name: AUTORENEW_TOOL,
          description:
            "Set auto-renewal ON or OFF for a box that already exists. This is the ONLY thing that moves it: the consent toggle sent with the rental does not, and a box rented with auto-renewal switched on still shows it off in the customer's portal until this is called. Call it once the rental is confirmed and paid, with the choice the customer actually made — including when they chose NO, since the default is not reliably off. It reads the box's own record first, so a box already in the requested state costs nothing.",
          input_schema: {
            type: "object",
            properties: {
              boxNumber: { type: "string", description: "The box number, e.g. 450294" },
              emirateCode: { type: "string", description: "Three-letter emirate code, e.g. DXB" },
              enabled: { type: "boolean", description: "True to enable auto-renewal, false to disable it" },
            },
            required: ["boxNumber", "emirateCode", "enabled"],
          },
        },
        {
          name: LICENCE_TOOL,
          description:
            "Look up one company by its trade licence number and check who owns it. Pass emiratesId as well to have the ownership check done for you: it compares the customer's Emirates ID against the licence's registered owners. This is the only lookup that can confirm the licence is really theirs.",
          input_schema: {
            type: "object",
            properties: {
              entityCode: { type: "string", description: `Issuing authority code from ${AUTHORITIES_TOOL}` },
              licenceNo: { type: "string", description: "Trade licence number as printed on the licence" },
              emiratesId: { type: "string", description: "The customer's Emirates ID, to check against the owners on the licence" },
            },
            required: ["entityCode", "licenceNo"],
          },
        },
      ]
    : [];

  const extraTools = [...baseExtraTools, emailTool, ...epglReadTools, ...gsbTools];
  /**
   * Companies GSB has named this turn. Emirates Post is told whether a corporate
   * rental's details came from its own registry or from the customer, and by the
   * time the save runs the lookup is several turns in the past — so every company
   * the registry hands over is remembered as it arrives.
   */
  const gsbSeen = new Set(session.state.gsbCompanies ?? []);
  const rememberGsb = (rows: { tradeLicenseNo?: string; nameEn?: string; nameAr?: string }[]) => {
    for (const r of rows) {
      for (const v of [r.tradeLicenseNo, r.nameEn, r.nameAr]) {
        const k = normaliseCompanyKey(v);
        if (k) gsbSeen.add(k);
      }
    }
  };
  const runExtraTool = async (name: string, input: Record<string, unknown>) => {
    if (name === AUTHORITIES_TOOL || name === COMPANIES_TOOL || name === LICENCE_TOOL || name === MYBOXES_TOOL || name === MYCOMPANIES_TOOL) {
      const env = agent.definition.activeEnvironment ?? "production";
      // The customer's own session is what the MOE endpoints mean by "requires
      // UAE PASS"; a GSB service credential, once configured, takes precedence.
      const caller = backendSessionToken ?? hostToken ?? uaePassIdentityToken;
      try {
        if (name === AUTHORITIES_TOOL) {
          const list = await listIssuingEntities(agent.id, env, caller);
          return {
            result: list.length
              ? JSON.stringify(list)
              : "NO AUTHORITIES RETURNED. Do not substitute a list of your own — tell the customer you cannot pull the list and ask for the authority name printed on their licence, or the trade licence number.",
          };
        }
        if (name === MYCOMPANIES_TOOL) {
          // Two different questions wear the same words. The licensing registry
          // knows what is registered to the customer's Emirates ID; the box list
          // knows which companies they already hold PO Boxes for. Asked "what
          // companies do I have", we answered from the registry alone and left out
          // the two they had rented boxes for that same afternoon.
          const eid = String(input.emiratesId ?? "");
          const [registry, boxes] = await Promise.all([
            companiesByEmiratesId(agent.id, env, eid, caller).catch(() => []),
            poBoxesByEmiratesId(agent.id, env, eid, caller).catch(() => []),
          ]);
          rememberGsb(registry);
          const onBoxes = boxes.filter((b) => b.rentType === "Corporate" && b.holderName);
          const known = new Set(registry.map((c) => (c.nameEn ?? "").trim().toLowerCase()).filter(Boolean));
          const extra = onBoxes
            .filter((b) => !known.has(String(b.holderName).trim().toLowerCase()))
            .map((b) => ({ nameEn: b.holderName, poBox: b.boxNumber, emirate: b.emirate, bundleId: b.bundleId, boxStatus: b.status }));
          if (!registry.length && !extra.length) {
            return {
              result:
                "NO COMPANIES are registered against this Emirates ID and they hold no corporate PO Boxes. That is a normal answer, not an error — say so plainly and ask for the issuing authority and trade licence number instead.",
            };
          }
          return {
            result:
              (registry.length
                ? `REGISTERED TO THEIR EMIRATES ID at the licensing authority (${registry.length}):\n${JSON.stringify(registry)}\n`
                : "NOTHING is registered to their Emirates ID at the licensing authority.\n") +
              (extra.length
                ? `\nCOMPANIES THEY ALREADY HOLD A PO BOX FOR, which the registry above does not list (${extra.length}). These are just as real — the box exists — so include them when the customer asks what companies they have, and say which box each one is for and what state it is in ("Pending approval" means Emirates Post is still reviewing the trade licence, not that anything failed):\n${JSON.stringify(extra)}`
                : "\nThey hold no corporate PO Boxes beyond what is listed above."),
          };
        }
        if (name === MYBOXES_TOOL) {
          const boxes = await poBoxesByEmiratesId(agent.id, env, String(input.emiratesId ?? ""), caller);
          return {
            result: boxes.length
              ? JSON.stringify(boxes) +
                "\n\nrentType says whether a box is Personal or Corporate, and on a Corporate box holderName is the COMPANY it belongs to — name it when you list that box, and treat it as one of the customer's companies. status is already in words: \"Pending approval\" means Emirates Post is still reviewing the trade licence, which is a normal stage of a corporate rental and NOT a failure or a payment problem."
              : "NO PO BOXES are held under this Emirates ID. Say so plainly and continue — it is a normal answer for a first-time customer, not an error.",
          };
        }
        if (name === COMPANIES_TOOL) {
          const rows = await companiesByAuthority(agent.id, env, String(input.entityCode ?? ""), caller);
          rememberGsb(rows);
          return {
            result: rows.length
              ? JSON.stringify(rows)
              : "NO COMPANIES registered under that authority were returned. Ask the customer for their trade licence number instead.",
          };
        }
        const found = await companyByLicence(
          agent.id, env, String(input.entityCode ?? ""), String(input.licenceNo ?? ""), caller
        );
        if (found) rememberGsb([found.company]);
        if (!found) {
          return {
            result:
              "NO MATCH for that trade licence number under that authority. Check the authority is right before concluding the licence does not exist, and fall back to the uploaded licence document.",
          };
        }
        const eid = String(input.emiratesId ?? "").trim();
        if (!eid) return { result: JSON.stringify(found) };
        // Three-valued on purpose: "no owner record carries a readable Emirates
        // ID" is not "this person is not an owner". See lib/gsbLookup.ownerMatch.
        const verdict = ownerMatch(found.owners, eid);
        const note =
          verdict === "match"
            ? "OWNERSHIP CONFIRMED: the customer's Emirates ID matches an owner registered on this licence."
            : verdict === "no-match"
              ? "OWNERSHIP NOT CONFIRMED: the customer's Emirates ID does not match any owner on this licence. Do not refuse them outright — say the licence is registered to someone else and ask whether they are acting for the company, then route to document review."
              : "OWNERSHIP UNKNOWN: the licence's owner records carry no Emirates ID that can be compared. This is NOT a failed check — say nothing about ownership either way and continue with document review.";
        return { result: `${note}\n${JSON.stringify(found)}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        // The expected state until the GSB credential lands. Deliberately not an
        // error: an explicit "there is no list" is what stops the model inventing one.
        if (msg.includes("GSB_NO_CREDENTIAL")) {
          return {
            result:
              "LOOKUP NOT CONNECTED in this environment, so there is no list of issuing authorities and no way to verify a licence. Tell the customer plainly that you cannot pull the list right now, and ask them to type the authority name exactly as printed on their trade licence, or give you the licence number. NEVER list authorities from your own knowledge to fill this gap — the names may be real but the codes behind them are what the system matches on, and a made-up list sends the customer down a path that cannot complete.",
          };
        }
        log.error("gsb_read_failed", err, { ...a, tool: name });
        return {
          result: `LOOKUP UNAVAILABLE: ${msg}. Ask the customer for the authority name and licence number instead, and never substitute a list of your own.`,
          isError: true,
        };
      }
    }
    if (name === AUTORENEW_TOOL) {
      const env = agent.definition.activeEnvironment ?? "production";
      const caller = backendSessionToken ?? hostToken ?? uaePassIdentityToken;
      if (!caller) {
        return {
          result:
            "AUTO-RENEWAL CANNOT BE SET without the customer's signed-in session. Do not describe this as a failure of the rental — the box is rented. Tell them auto-renewal can be switched on from their PO Box page in the portal.",
        };
      }
      try {
        const r = await setAutoRenew(
          agent.id, env,
          String(input.boxNumber ?? ""), String(input.emirateCode ?? ""),
          input.enabled === true, caller
        );
        if (r.ok) {
          return {
            result: r.changed
              ? `AUTO-RENEWAL IS NOW ${r.enabled ? "ON" : "OFF"} for this box.`
              : `AUTO-RENEWAL WAS ALREADY ${r.enabled ? "ON" : "OFF"} for this box. Nothing needed changing — do not report this as a problem.`,
          };
        }
        log.warn("nxn_auto_renew_failed", { ...a, reason: r.reason, detail: r.detail });
        return {
          result:
            `AUTO-RENEWAL COULD NOT BE SET (${r.reason}). The rental itself is unaffected — say so plainly, tell the customer auto-renewal is not switched on yet and that they can set it from their PO Box page, and do NOT retry this call. Detail for the log: ${r.detail}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        log.error("nxn_auto_renew_error", err, { ...a });
        return {
          result: `AUTO-RENEWAL COULD NOT BE SET: ${msg}. The rental is unaffected — tell the customer they can switch it on from their PO Box page. Do not retry.`,
        };
      }
    }
    if (name === PIN_TOOL) {
      const env = agent.definition.activeEnvironment ?? "production";
      const caller = backendSessionToken ?? hostToken ?? uaePassIdentityToken;
      if (!caller) {
        return {
          result:
            "THE PIN COULD NOT BE LOOKED UP because the customer is not signed in with Emirates Post. Ask them for the area in words instead and use " + AREAS_TOOL + ".",
        };
      }
      const found = await addressFromPin(
        agent.id, env, Number(input.latitude), Number(input.longitude), caller, body.locale
      ).catch(() => null);
      if (!found) {
        return {
          result:
            `THAT LOCATION COULD NOT BE RESOLVED. Do not guess at the area from the coordinates. Ask the customer for the area in words and use ${AREAS_TOOL}, or offer the map again.`,
        };
      }
      if (found.outOfService) {
        return {
          result:
            `EMIRATES POST DOES NOT DELIVER to that location${found.area ? ` (${found.area}${found.emirate ? `, ${found.emirate}` : ""})` : ""}. Say so plainly, and offer either a different address or a branch-collected box instead of MyHome. Do not proceed with a MyHome rental for this address.`,
        };
      }
      const detail = [found.building, found.street, found.area, found.emirate].filter(Boolean).join(", ");
      const remote = found.remote
        ? " Emirates Post marks this location as OUTSIDE ITS NORMAL DELIVERY AREA — tell the customer deliveries there may be slower or limited, and let them decide before continuing."
        : "";
      if (found.region) {
        return {
          result:
            `THE PIN RESOLVES TO: ${detail}\n` +
            JSON.stringify({
              regionName: found.region.code,
              areaName: found.region.nameEn,
              emirateCode: found.emirateCode,
              streetOrLandmark: found.street ?? "",
              buildingName: found.building ?? "",
              detailedAddress: detail,
            }) +
            remote +
            `\n\nSHOW the customer this address and ask them to confirm it, and to add their villa or apartment number — the pin cannot know it. Send regionName EXACTLY as given. The pin also decides the EMIRATE: if ${found.emirateCode} is not the emirate they picked for the box, tell them, because the box has to be in the emirate they live in.`,
        };
      }
      const near = (found.candidates ?? []).map((r) => `${r.code} = ${r.nameEn}`).join("\n");
      return {
        result:
          `THE PIN RESOLVES TO: ${detail || "an unnamed location"}${found.emirateCode ? ` (${found.emirateCode})` : ""}, but Emirates Post's area name for it does not match a delivery area outright. The two systems spell places differently, so the list below is what it is CLOSEST to — the first is usually right, but the customer confirms it, never you.` + remote +
          (near ? `\n\nAsk the customer which of these their address is in, as CARDS, and send the CODE as regionName:\n${near}` : `\n\nAsk them for the district in words and use ${AREAS_TOOL}.`),
      };
    }
    if (name === AREAS_TOOL) {
      const env = agent.definition.activeEnvironment ?? "production";
      const emirate = String(input.emirateCode ?? "").trim().toUpperCase();
      const rows = await regionsFor(env, emirate);
      if (!rows.length) {
        return {
          result:
            "THE AREA LIST COULD NOT BE LOADED for that emirate. Do not substitute areas of your own — the code is what the address is matched on, and an invented one sends the box to the wrong place. Ask the customer for their area in words, and say you will confirm it before the box is set up.",
        };
      }
      const q = String(input.query ?? "").trim();
      const hits = searchRegions(rows, q, 12).filter((r) => r.deliverable);
      if (!hits.length) {
        // The customer may be naming a real place in the wrong emirate. Told
        // only "not a district in Ajman", they typed a second Dubai place and
        // got the same answer again.
        const elsewhere = await searchOtherEmirates(env, emirate, q).catch(() => []);
        const emirateName = EMIRATES.find((e) => e.code === emirate)?.name ?? emirate;
        if (elsewhere.length) {
          const where = elsewhere.map((x) => `${x.region.nameEn} is in ${x.emirateName}`).join("; ");
          return {
            result:
              `"${q}" IS NOT IN ${emirateName.toUpperCase()} — it is in another emirate: ${where}. Say that plainly, because the customer almost certainly has the emirate wrong rather than the area. Ask whether they want the box in that emirate instead (if so, the emirate has to change and the box must be chosen again there), or, if the address really is in ${emirateName}, ask which ${emirateName} district it is in. Do NOT repeat that it is not a delivery area.`,
          };
        }
        const samples = rows.filter((r) => r.deliverable).slice(0, 8).map((r) => r.nameEn).join(", ");
        return {
          result:
            `NO DELIVERY AREA MATCHES "${q}" in ${emirateName}, and it is not a known area in another emirate either. It is probably a building, tower or community name rather than a district. Ask which district it sits in, and offer these REAL ${emirateName} districts as examples — never districts of your own: ${samples}. There are ${rows.length} in total; do not list them all and do not pick one yourself.`,
        };
      }
      return {
        result:
          `Delivery areas in ${emirate} matching "${q}". Show these to the customer as CARDS and let them choose; send the CODE as myHomeProfile.myHomeAddress.regionName.\n` +
          JSON.stringify(hits.map((r) => ({ code: r.code, nameEn: r.nameEn, nameAr: r.nameAr }))),
      };
    }
    if (name === COMPANY_TOOL || name === FORM9_TOOL || name === COMPANY_BY_EID_TOOL) {
      const env = agent.definition.activeEnvironment ?? "production";
      try {
        if (name === COMPANY_BY_EID_TOOL) {
          const found = await companyByEmiratesId(agent.id, env, String(input.emiratesId ?? ""));
          if (!found.length) {
            return {
              result:
                "NO COMPANY is on file against that Emirates ID. This is normal — not every contact record carries one — so do not treat it as a problem: ask for the trade licence number and continue as usual.",
            };
          }
          if (found.length > 1) {
            return {
              result:
                `This person is a contact on ${found.length} companies. Show the names and ask which one this application is for before using any of them:\n` +
                JSON.stringify(found),
            };
          }
          return { result: JSON.stringify(found[0]) };
        }
        if (name === COMPANY_TOOL) {
          const found = await companyByTradeLicense(agent.id, env, String(input.tradeLicenseNumber ?? ""));
          if (!found.length) {
            return {
              result:
                "NO MATCH: EPGL has no company registered under that trade licence number. Do not treat this as an error — continue collecting the details from the customer and their documents as normal.",
            };
          }
          // A licence number can match a parent AND its branches; the filing always
          // belongs to the main company, so never silently pick one.
          if (found.length > 1) {
            return {
              result:
                `MORE THAN ONE COMPANY is registered under that trade licence number (${found.length}). ` +
                "Show the customer the names and ask which is theirs before using any of them:\n" +
                JSON.stringify(found),
            };
          }
          return { result: JSON.stringify(found[0]) };
        }
        const quarters = await form9ByAccountId(agent.id, env, String(input.accountId ?? ""));
        return {
          result: quarters.length
            ? JSON.stringify(quarters)
            : "NO FORM 9 SUBMISSIONS on file for this company yet — collect the quarterly figures from the customer as normal.",
        };
      } catch (err) {
        log.error("epgl_read_failed", err, { ...a, tool: name });
        return {
          result: `LOOKUP UNAVAILABLE: ${err instanceof Error ? err.message : "unknown error"}. Continue with the customer's own answers and documents; do not tell them the system is broken.`,
          isError: true,
        };
      }
    }
    if (name !== EMAIL_TOOL_NAME) return execIntegration(name, input);
    const to = String(input.to ?? "").trim();
    const subject = String(input.subject ?? "").slice(0, 180) || `${agent.definition.name} confirmation`;
    const bodyText = String(input.body ?? "");
    // Sent as both: the text part unchanged, plus an HTML rendering so the details
    // read as details rather than as one undifferentiated block.
    const res = await sendEmail({ to, subject, text: bodyText, html: textToHtml(bodyText, subject) });
    await audit({ ...a, actor: "agent", action: res.ok ? "email_sent" : "email_send_failed", payload: { to, subject, reason: res.reason } });
    if (res.ok) {
      return {
        result: `EMAIL SENT to ${to}. You may now confirm to the customer that the email was sent. If they later say it hasn't arrived, suggest checking spam and offer to resend (call this tool again).`,
      };
    }
    return {
      result:
        `EMAIL NOT SENT (${res.reason}). Do NOT tell the customer an email was sent. ` +
        (res.reason === "email_not_configured"
          ? "Email delivery is not configured in this environment — offer the receipt download link or the reference number instead, and apologise briefly."
          : "Offer to try again, or provide the receipt download link / reference number instead."),
      isError: true,
    };
  };

  const encoder = new TextEncoder();
  /**
   * Best-effort work that must NOT hold the chat open (FB-1393/FB-1435: the chat
   * kept showing "thinking" for seconds after the reply was complete, because the
   * spinner only stops when this stream closes). Anything queued here is invisible
   * to the customer and runs once the response has been delivered. Anything the
   * NEXT turn depends on (the persisted message, the case state) stays inline.
   */
  const deferred: (() => Promise<void>)[] = [];
  // Tracked out here so cancel() can reach them: when the BROWSER goes away
  // (navigation, refresh, network blip) the stream is cancelled and the
  // controller is closed under us. Without this, the next send() threw
  // "Invalid state: Controller is already closed", which aborted the turn
  // mid-flight — so the assistant's reply and the collected case data were
  // never persisted and the customer had to start that turn again.
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      // Writing to a stream nobody is reading is not an error worth failing the
      // turn over: mark it closed and let the work finish so the reply is saved.
      const send = (ev: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sse(ev)));
        } catch {
          closed = true;
        }
      };
      // Heartbeat: keep the SSE connection alive while the model is thinking or a
      // tool round is running (no bytes flow then), so browsers/proxies don't drop
      // it as idle. SSE comment lines (": ...") are ignored by the client parser.
      heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { closed = true; }
      }, 15000);
      try {
        send({ type: "session", conversationId: session.conversationId });
        if (isNewSession) {
          await emitEvent({ type: "conversation.started", ...a, attributes: { locale: body.locale } });
        }
        // Internal directives (pulse / payment settled / document uploaded) are
        // triggers — don't store them as user messages.
        if (!isPulse && !isPaymentSettled && !isDocumentUploaded) await appendMessage(session.conversationId, "user", body.userMessage);

        // PRD AI-governance: classify intent to gate transactional journeys on goal
        // confidence. Run it CONCURRENTLY with the turn (not blocking) so the first
        // token isn't delayed by an extra model round-trip; the orchestrator awaits
        // it after the first round, by which point it's ready. The gate only matters
        // when STARTING a journey, so skip it once a journey is active or on a pulse.
        let intentPromise: Promise<{ intent: string; confidence: number } | undefined> | undefined;
        if (!session.state.journeyKey && !isPulse && !isPaymentSettled && !isDocumentUploaded) {
          intentPromise = classifyIntent(agent.definition, body.userMessage, body.locale)
            .then((intent) => {
              void emitEvent({
                type: "intent.identified",
                ...a,
                customerType: authenticated ? "authenticated" : "guest",
                language: body.locale,
                outcome: intent.intent,
                attributes: { intent: intent.intent, confidence: intent.confidence },
              }).catch(() => {});
              return intent;
            })
            .catch(() => undefined); // best-effort: a classification failure never blocks
        }

        let finalState = session.state;
        let finalText = "";
        // The pay button is only ever as good as the URL behind it, and the model
        // writes that URL from memory. Anything it emits is checked against the
        // order the backend actually created before the customer can click it.
        // Scoped to agents that take payment on a backend gateway, which is the
        // only mode that produces a pay block at all.
        const payGuard = (agent.definition.journeys ?? []).some(
          (j) => j.submission?.apiFlow?.saveTool && j.submission?.apiFlow?.confirmTool
        )
          ? payFenceGuard(() => apiTools.getLastHold()?.paymentUrl ?? null)
          : null;
        let citedThisTurn = false;
        let submittedRef: string | null = null;

        for await (const ev of runTurn({
          agent: agent.definition,
          agentId: agent.id,
          caseId: session.caseId,
          history: session.history,
          userMessage: effectiveMessage,
          case: session.state,
          locale: body.locale,
          authenticated,
          userRef,
          adapters,
          intentPromise,
          businessOpen,
          customerContext,
          extraTools,
          authoritativeAmount,
          holdBackedSaveTools,
          holdPresent,
          runExtraTool,
        })) {
          // runTurn yields its own error event, which would otherwise reach the
          // customer verbatim — the provider's raw 429 body was appearing in the
          // chat this way, bypassing the catch below.
          if (ev.type === "error") {
            log.error("turn_failed", ev.message, { agentId: agent.id, conversationId: session.conversationId });
            send({ type: "error", message: customerFacingError(ev.message, body.locale) });
            continue;
          }
          if (payGuard && ev.type === "text") {
            const out = payGuard.push(ev.delta);
            if (out) { send({ type: "text", delta: out }); finalText += out; }
          } else {
            // Anything that is not text ends the run the fence could be inside, so
            // whatever is still held goes out before it -- held bytes must never
            // be dropped on the floor.
            if (payGuard) {
              const rest = payGuard.flush();
              if (rest) { send({ type: "text", delta: rest }); finalText += rest; }
            }
            send(ev);
          }
          // Standard analytics attributes shared by every event this turn.
          const std = {
            ...a,
            customerType: (authenticated ? "authenticated" : "guest") as "authenticated" | "guest",
            language: body.locale,
            journeyType: finalState.journeyKey ?? undefined,
          };
          if (ev.type === "text") {
            // Accumulate the full streamed reply (including text from rounds
            // before tool calls + the inserted separators) so the persisted
            // message matches what the user saw, not just the final round.
            if (!payGuard) finalText += ev.delta;
          } else if (ev.type === "case") finalState = ev.state;
          else if (ev.type === "done") {
            finalState = ev.state;
            // Fall back to the round's text only if nothing was streamed.
            if (!finalText) finalText = ev.message;
          } else if (ev.type === "citation" && !citedThisTurn) {
            citedThisTurn = true;
            await emitEvent({ type: "knowledge.retrieved", ...std, attributes: { source: ev.source } });
          } else if (ev.type === "lookup") {
            await emitEvent({ type: "shipment.lookup", ...std, outcome: ev.kind, attributes: { kind: ev.kind } });
          } else if (ev.type === "payment_initiated") {
            // Every charge records the state of the reservation gate that let it
            // through. Three customers have now been charged for boxes that were
            // never recorded, and each post-mortem stalled on not knowing whether
            // the gate ran and allowed it or never ran at all.
            await audit({
              ...a,
              actor: "system",
              action: "payment_gate",
              payload: {
                amount: ev.amount,
                journeyKey: finalState.journeyKey,
                saveTool:
                  (agent.definition.journeys ?? []).find((j) => j.key === finalState.journeyKey)?.submission?.apiFlow
                    ?.saveTool ?? null,
                holdBackedSaveTools,
                holdPresent: holdPresent(),
                hold: apiTools.getLastHold(),
              },
            });
            await getDb()
              .insert(payments)
              .values({
                caseId: session.caseId,
                conversationId: session.conversationId,
                agentId: agent.id,
                reference: ev.reference,
                amount: Math.round(ev.amount),
                currency: ev.currency,
                status: "initiated",
              })
              .onConflictDoNothing();
            await emitEvent({ type: "payment.initiated", ...std, referenceId: ev.reference, attributes: { reference: ev.reference, amount: ev.amount } });
            await audit({ ...a, actor: "agent", action: "payment_initiated", payload: { reference: ev.reference, amount: ev.amount } });
          } else if (ev.type === "submitted") {
            submittedRef = ev.reference;
            await audit({ ...a, actor: "agent", action: "case_submitted", payload: { reference: ev.reference, journey: finalState.journeyKey } });
            await emitEvent({ type: "journey.completed", ...std, outcome: "completed", referenceId: ev.reference, attributes: { journey: finalState.journeyKey, reference: ev.reference } });
            await emitEvent({ type: "crm.case.created", ...std, referenceId: ev.reference, attributes: { reference: ev.reference } });
            await emitEvent({ type: "conversation.completed", ...std, outcome: "resolved", referenceId: ev.reference, attributes: { journey: finalState.journeyKey } });
          } else if (ev.type === "escalation") {
            await audit({ ...a, actor: "agent", action: "escalation_created", payload: { reference: ev.reference } });
            await emitEvent({ type: "callback.requested", ...std, referenceId: ev.reference, attributes: { reference: ev.reference, businessOpen } });
          }
        }
        if (payGuard) {
          const rest = payGuard.flush();
          if (rest) { send({ type: "text", delta: rest }); finalText += rest; }
        }

        // Deterministic "browse nearby branches" map: the model reliably shows the
        // branch cards but often forgets the ```map block, so if it looked up branch
        // locations this turn and rendered cards without a map, append the block
        // ourselves (streamed + persisted). Uses the exact emirate + bundle the
        // model queried, so the map fetches the same branches.
        const branchQuery = apiTools.getLastBranchQuery();
        if (branchQuery && /```\s*cards/i.test(finalText) && !/```\s*map/i.test(finalText)) {
          const mapBlock = `\n\n\`\`\`map\nemirate: ${branchQuery.emirate}\nbundle: ${branchQuery.bundle}\n\`\`\`\n`;
          send({ type: "text", delta: mapBlock });
          finalText += mapBlock;
        }

        // Deterministic upload widget (feedback FB-1425: "AI says upload slots
        // appeared but no upload fields display"): when the reply talks about
        // uploading but contains no ```upload block, append the block(s) for the
        // active journey's still-pending documents ourselves — the widget then
        // always renders where the assistant said it would.
        const activeJourney = findJourney(agent.definition, finalState.journeyKey);
        if (agent.definition.documentsInChat && activeJourney && !/```\s*upload/i.test(finalText)) {
          const docStatus = new Map(finalState.documents.map((d) => [d.key, d.status]));
          const pendingDocs = activeJourney.steps
            .flatMap((s) => s.documents)
            .filter(
              (d) =>
                evalCondition(d.condition, finalState.data) &&
                !["uploaded", "accepted"].includes(docStatus.get(d.key) ?? "")
            );
          const mentionsUpload = /upload|attach\b|attachment|ارفع|يرفع|برفع|رفع|حمّل|تحميل|إرفاق|أرفق|ارفاق/i.test(finalText);
          if (pendingDocs.length && mentionsUpload) {
            const blocks = pendingDocs
              .slice(0, 2)
              .map((d) => `\n\n\`\`\`upload\nkey: ${d.key}\n\`\`\``)
              .join("");
            send({ type: "text", delta: blocks });
            finalText += blocks;
          }
        }

        // Completed transaction extras (feedback FB-1396): a paid, submitted case
        // always ends with a receipt download link (the model additionally offers
        // email via the send_confirmation_email tool).
        if (submittedRef && finalState.payment.status === "paid" && finalState.payment.reference && !finalText.includes("/api/receipt/")) {
          const receiptUrl = `/api/receipt/${encodeURIComponent(finalState.payment.reference)}?c=${encodeURIComponent(session.conversationId)}`;
          const receiptLine =
            body.locale === "ar" ? `\n\n[تنزيل الإيصال](${receiptUrl})` : `\n\n[Download your receipt](${receiptUrl})`;
          send({ type: "text", delta: receiptLine });
          finalText += receiptLine;
        }

        // Back-office coordination (feedback FB-1391/FB-1392): key-delivery and
        // MyHome submissions notify the branch/EMX teams like the website flow.
        // DEFERRED (FB-1393/FB-1435): sending these emails takes seconds, and the
        // customer's chat stayed "thinking" for the whole time because the spinner
        // only stops when this stream closes. Nothing here is customer-visible, so
        // it runs after the response is finished.
        if (submittedRef) {
          const ref = submittedRef;
          deferred.push(async () => {
            try {
              const outcomes = await notifyOpsForSubmission({
                reference: ref,
                journeyKey: finalState.journeyKey ?? "",
                data: finalState.data,
                agentName: agent.definition.name,
              });
              for (const o of outcomes) {
                await audit({
                  ...a,
                  actor: "system",
                  action: o.result.ok ? "ops_notified" : "ops_notify_skipped",
                  payload: { kind: o.kind, to: o.to, trackingRef: o.trackingRef, reason: o.result.ok ? undefined : o.result.reason },
                });
              }
            } catch (e) {
              log.error("ops_notify_failed", e, { agentId: agent.id, reference: ref });
            }
          });
        }

        // Documents follow the submission into the system of record (feedback
        // FB-1326/FB-1402): after a Salesforce-backed submission succeeds, every
        // uploaded document is pushed via the integration's uploadDocument
        // operation, linked to the license request id — mirroring how the
        // website attaches files to the case. Best-effort per file, audited.
        // Also DEFERRED (FB-1393/FB-1435): each file is a base64 upload, so a
        // multi-document submission held the chat open for seconds after the
        // customer had already read the confirmation.
        const submitJourney = findJourney(agent.definition, finalState.journeyKey);
        const uploadDocTool = submitJourney?.submission?.apiFlow?.saveTool ? serverOnlyDocTool : undefined;
        const storageGet = adapters.storage?.get?.bind(adapters.storage);
        if (submittedRef && uploadDocTool && storageGet && /^[a-zA-Z0-9]{15,18}$/.test(submittedRef)) {
          const ref = submittedRef;
          const tool = uploadDocTool;
          const attachedDocs = finalState.documents.filter((d) => d.status === "uploaded" || d.status === "accepted");
          const sctx = adapterContext(agent.definition, agent.definition.integrations.storage);
          deferred.push(async () => {
            for (const d of attachedDocs) {
              try {
                const row = await getDb().query.documents.findFirst({
                  where: and(eq(documentsTable.caseId, session.caseId), eq(documentsTable.key, d.key)),
                  orderBy: [desc(documentsTable.createdAt)],
                });
                if (!row?.storageKey) continue;
                const stored = await storageGet(sctx, { storageKey: row.storageKey });
                if (!stored) {
                  await audit({ ...a, actor: "system", action: "sf_document_skipped", payload: { key: d.key, reason: "bytes_unavailable" } });
                  continue;
                }
                const fileName = d.fileName || `${d.key}.pdf`;
                const res = await execIntegration(tool, {
                  body: {
                    licenseRequestId: ref,
                    fileName,
                    fileType: (fileName.split(".").pop() ?? "pdf").toLowerCase(),
                    versionData: Buffer.from(stored.bytes).toString("base64"),
                  },
                });
                await audit({
                  ...a,
                  actor: "system",
                  action: res.isError ? "sf_document_failed" : "sf_document_attached",
                  payload: { key: d.key, fileName, reference: ref },
                });
              } catch (e) {
                log.error("sf_document_push_failed", e, { agentId: agent.id, key: d.key, reference: ref });
              }
            }
          });
        }

        const cust = (authenticated ? "authenticated" : "guest") as "authenticated" | "guest";
        // Journey start detection (journeyKey newly set this turn).
        if (!startJourney && finalState.journeyKey) {
          await emitEvent({ type: "journey.started", ...a, customerType: cust, language: body.locale, journeyType: finalState.journeyKey, attributes: { journey: finalState.journeyKey } });
        }

        await appendMessage(session.conversationId, "assistant", finalText);
        // A hold issued this turn belongs to the case, not to this request.
        const offeredNow = apiTools.getOfferedBoxIds();
        if (offeredNow.length && offeredNow.join(",") !== (finalState.offeredBoxIds ?? []).join(",")) {
          finalState = { ...finalState, offeredBoxIds: offeredNow };
        }
        const heldNow = apiTools.getLastHold();
        const holdChanged =
          heldNow &&
          (heldNow.reference !== finalState.hold?.reference ||
            (heldNow.paymentRef ?? null) !== (finalState.hold?.paymentRef ?? null) ||
            (heldNow.paidAt ?? null) !== (finalState.hold?.paidAt ?? null));
        if (heldNow && holdChanged) {
          finalState = {
            ...finalState,
            hold: {
              ...heldNow,
              uniqueBoxId: heldNow.uniqueBoxId ?? null,
              bundleId: heldNow.bundleId ?? null,
              services: heldNow.services ?? [],
              paidAt: heldNow.paidAt ?? null,
              orderNo: heldNow.orderNo ?? null,
              paymentRef: heldNow.paymentRef ?? null,
              paymentUrl: heldNow.paymentUrl ?? null,
            },
          };
        }
        // Stamped here, not at the top: a `case` event replaces finalState
        // wholesale, so a mark set before the turn would be gone by the end of it.
        if (isPulse && !finalState.pulsedAt) {
          finalState = { ...finalState, pulsedAt: new Date().toISOString() };
        }
        if (gsbSeen.size !== (finalState.gsbCompanies ?? []).length) {
          finalState = { ...finalState, gsbCompanies: [...gsbSeen] };
        }

        // Customer Pulse: the UAE government satisfaction survey, shown where
        // Emirates Post's own portal shows it — straight after a purchase
        // completes and the customer has their confirmation in front of them.
        //
        // "Completed" has to mean the money arrived, not that the reply sounded
        // final: on their gateway that is Emirates Post confirming the payment,
        // and on ours it is a settled payment plus a submitted case. Everything
        // about this is best-effort — the box is rented either way, so a survey
        // that cannot be minted is never mentioned to the customer.
        const pulseService = pulseServiceFor(finalState.journeyKey);
        const purchase =
          finalState.hold?.paidAt
            ? { reference: finalState.hold.orderNo ?? finalState.hold.reference, amount: finalState.hold.amount }
            : submittedRef && finalState.payment.status === "paid"
              ? { reference: finalState.payment.reference ?? submittedRef, amount: finalState.payment.amount }
              : null;
        if (pulseService && purchase?.reference && !finalState.surveyIssuedAt) {
          const token = await pulseSurveyToken({
            service: pulseService,
            transactionId: String(purchase.reference),
            feesAed: typeof purchase.amount === "number" ? purchase.amount : null,
            customer: {
              emiratesId: verifiedEmiratesId,
              name: verifiedIdentity?.name,
              mobile: verifiedIdentity?.mobile ?? (finalState.data.contact_phone as string | undefined),
              email: (finalState.data.contact_email as string | undefined) ?? undefined,
            },
          }).catch(() => null);
          if (token) {
            finalState = { ...finalState, surveyIssuedAt: new Date().toISOString() };
            send({ type: "survey", token, locale: body.locale, sandbox: pulseIsSandbox() });
            await audit({ ...a, actor: "system", action: "survey_offered", payload: { service: pulseService, transactionId: String(purchase.reference) } });
          }
        }
        await saveCase(session.caseId, finalState);
        // Persist a BACKEND session token minted this turn (e.g. OTP login) for later
        // turns. Never overwrite a stored UAE PASS identity token with it: the two
        // serve different integrations (uaepass_live needs the identity token), and
        // one column holds one token — so identity wins and the captured token is
        // used for this turn only.
        const captured = apiTools.getCapturedToken();
        if (captured && captured !== session.sessionToken && session.sessionTokenKind !== "uaepass") {
          await saveSessionToken(session.conversationId, captured, "backend");
        }
      } catch (err) {
        log.error("chat_stream_failed", err, { agentId: agent.id, conversationId: session.conversationId });
        // Never relay the provider's own text: a throttled model returned a raw
        // 429 JSON blob ("Rate limit of 50000 per 60s exceeded for
        // UserByModelByMinuteUncachedInputTokens…") straight into the chat.
        // The full error is already logged above for us.
        send({ type: "error", message: customerFacingError(err, body.locale) });
      } finally {
        clearInterval(heartbeat);
        // Already closed means the client cancelled — closing again throws and
        // would skip the deferred drain below.
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* client already gone */ }
        }
        // Now that the customer's turn is complete, drain the deferred work. Not
        // awaited into the stream — failures are logged, never surfaced.
        for (const job of deferred) {
          try {
            await job();
          } catch (e) {
            log.error("deferred_job_failed", e, { agentId: agent.id, conversationId: session.conversationId });
          }
        }
      }
    },
    // The consumer went away. Stop writing; the turn itself carries on so the
    // reply and case state still get persisted and the customer can resume.
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
