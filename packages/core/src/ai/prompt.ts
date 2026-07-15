import type { AgentDefinition, CaseState, Locale } from "@dialog/config";
import { tr } from "@dialog/config";
import { findJourney } from "../case/engine";

export interface SystemPrompt {
  /** Large, slow-changing prefix — marked cacheable so the up-to-6 tool rounds
   *  in a turn (and subsequent turns in the session) reuse it via prompt caching. */
  stable: string;
  /** Small, per-round-changing tail (intent confidence + active journey + live
   *  case state) — never cached. */
  volatile: string;
}

/**
 * Builds the system prompt, split into a cacheable stable prefix and a volatile
 * tail. Layers: platform conversational contract → per-agent persona → guardrails
 * (stable) and the live confidence/journey/case context (volatile). Everything
 * company-specific comes from the AgentDefinition, so the same builder serves
 * every tenant.
 */
/**
 * Renders step-by-step guidance for an API-native journey. Two modes:
 *  - Full (saveTool set): the transaction is created + paid + confirmed entirely
 *    through the real backend tools (live gateway). Use once the backend write is
 *    provisioned.
 *  - Pricing-only (no saveTool): real record lookup + authoritative pricing from
 *    the backend, then completion through the internal payment spine (reliable
 *    across turns). Use while the backend write/payment is unavailable.
 */
function renderApiFlow(f: NonNullable<NonNullable<import("@dialog/config").Journey["submission"]>["apiFlow"]>): string {
  const sys = f.service ? `the ${f.service} system` : "the connected backend";

  // Pricing-only mode: real details + real price, then internal checkout.
  if (!f.saveTool) {
    const lines: string[] = [
      `- Complete this journey using REAL data from ${sys} for everything, then take payment through the internal checkout. Never quote a price you did not get from a tool.`,
    ];
    if (f.detailsTool)
      lines.push(`  1. Call ${f.detailsTool} once to fetch the record and the values you need (current expiry, bundle, customer details). Reuse them — do not re-ask the customer for what the tool returned, and do not call it again on later turns.`);
    if (f.pricingTool)
      lines.push(`  2. Get the AUTHORITATIVE amount for the chosen option from ${f.pricingTool}. If you have ALREADY fetched and shown that exact price (e.g. on the option/duration card the customer just picked), REUSE it — do NOT call ${f.pricingTool} again for the same option. Quote exactly that figure and ask the customer to confirm.`);
    lines.push(`  3. After the customer confirms, call request_payment with amount = the exact figure from ${f.pricingTool ?? "pricing"} and share the secure link. WAIT for confirmation.`);
    lines.push(`  4. Once payment is confirmed (payment status "paid"), call submit_case ONCE to finalise and give the customer the reference. If the user says they paid but payment is not yet "paid", briefly say it's still processing — do NOT restart the journey, re-fetch details, or create a second payment.`);
    lines.push(`  Keep the case panel live: as soon as you learn each of this journey's fields, call collect_field for it (e.g. the box number, the chosen period) — including values you read from a tool — so the customer's side panel fills in step by step, not all at the end.`);
    if (f.notes) lines.push(`  Field-mapping notes: ${f.notes}`);
    return lines.join("\n");
  }

  // Full mode: real order creation + payment + confirmation on the live gateway.
  const lines: string[] = [
    `- This journey is completed END-TO-END through ${sys}. Drive the integration tools below; never quote a price you did not get from a tool.`,
  ];
  if (f.detailsTool)
    lines.push(`  1. Call ${f.detailsTool} to fetch the record and the values the next steps need (current expiry date, bundle, customer details). Use these — do not ask the user for data the tool already returned.`);
  if (f.pricingTool)
    lines.push(`  2. Get the AUTHORITATIVE amount for the chosen option from ${f.pricingTool}. If you have ALREADY fetched and shown that exact price (e.g. on the option/duration card the customer just picked), REUSE it — do NOT call ${f.pricingTool} again for the same option. Quote exactly that figure, then ask the customer to confirm.`);
  lines.push(
    `  3. After the customer confirms, call ${f.saveTool} to create the order. It returns a gateway payment URL (e.g. paymentGateWayResponse.paymentUrl) and a reference number — share that EXACT URL as the payment link${f.paymentReturnUrl ? ` (use paymentReturnUrl "${f.paymentReturnUrl}")` : ""}. Keep the reference number.`
  );
  if (f.confirmTool)
    lines.push(`  4. ONLY if ${f.saveTool} succeeded and returned a real reference number: after the customer says they have paid, call ${f.confirmTool} with that reference to verify, and confirm success only if the tool reports the payment succeeded. Never call ${f.confirmTool} with a reference that did not come from a successful ${f.saveTool}.`);
  if (f.fallbackToInternalPayment)
    lines.push(
      `  If ${f.saveTool} returns an error or a null/empty payload, switch to the internal checkout and stay on it (do NOT call ${f.confirmTool ?? "the confirm tool"}): call request_payment with amount = the exact figure from ${f.pricingTool ?? "the pricing step"}, share that link, and once payment is "paid" call submit_case to finalise.`
    );
  else lines.push(`  If any tool returns isSuccess=false or an error, relay the displayMessage plainly and offer a human handoff — never fabricate an order or payment.`);
  if (f.notes) lines.push(`  Field-mapping notes: ${f.notes}`);
  return lines.join("\n");
}

export function buildSystemPrompt(
  agent: AgentDefinition,
  state: CaseState,
  locale: Locale,
  authenticated: boolean,
  businessOpen?: boolean,
  intent?: { intent: string; confidence: number },
  // Server-verified facts about the signed-in customer (e.g. PO Boxes on file
  // from previous authenticated sessions) — so the agent never re-asks for them.
  customerContext?: string
): SystemPrompt {
  const journey = findJourney(agent, state.journeyKey);
  const g = agent.guardrails;
  const it = g.intentThresholds;
  const gt = g.goalThresholds;

  const intents = agent.intents
    .map((i) => `- ${i.key}: ${tr(i.description, locale)}${i.journey ? ` → journey "${i.journey}"` : ""}${i.requiresAuth ? " (requires sign-in)" : ""}`)
    .join("\n");

  // When this turn's classified intent maps to a journey and none is active yet,
  // surface a direct instruction so the model commits the journey before
  // collecting fields (keeps the case panel + readiness in sync from the start).
  const classifiedIntent = intent ? agent.intents.find((i) => i.key === intent.intent) : undefined;
  const suggestedJourney = !state.journeyKey && classifiedIntent?.journey ? classifiedIntent.journey : null;

  const journeyBlock = journey
    ? `ACTIVE JOURNEY: ${journey.key} — ${tr(journey.title, locale)}
Steps and the fields/documents each collects:
${journey.steps
        .map(
          (s) =>
            `  • ${s.key} (${tr(s.title, locale)})${s.requiresAuth ? " [auth]" : ""}\n` +
            s.fields.map((f) => `      field ${f.key}: ${tr(f.label, locale)}${f.validation.required ? " *" : ""}`).join("\n") +
            (s.fields.length && s.documents.length ? "\n" : "") +
            s.documents.map((d) => `      document ${d.key}: ${tr(d.label, locale)} (${d.requirement})`).join("\n")
        )
        .join("\n")}${journey.guidance ? `\n\nHow to run this journey:\n${journey.guidance}` : ""}`
    : "No active journey yet. Recognise intent first, then start the matching journey with set_journey.";

  const stable = `You are ${agent.name}, a conversational assistant. ${agent.persona}

# Conversational contract
- The conversation is the primary surface. Be calm, professional, warm, and concise — short, skimmable replies, not walls of text.
- Drive toward the customer's goal: take the next concrete step every turn rather than re-summarising. Lead with the answer, then any follow-up question.
- Ask for at most ONE thing at a time; never dump a long form. If several fields are needed, collect them across turns in a natural order.
- As soon as the user's goal maps to a supported journey and you are confident, call set_journey FIRST (before asking for or collecting any fields). Starting the journey is what populates the case panel and readiness tracking; do not collect details while no journey is active.
- Reflect every captured field/document into the case the moment you learn it:
  call collect_field for each value as it arrives (one call per field, including
  values you read from a tool), not batched at the end — the customer's side
  panel updates live from these calls. Do not claim something is saved unless you
  called the tool.
- Formatting: simple markdown only (**bold** for key values, short "###" headings when a reply has sections, "-" bullets). NEVER use emojis or decorative symbols; keep a clean, professional, government-service tone. Express status in words ("Active", "Off"), not icons.
- Punctuation: NEVER use an em-dash or en-dash ("—", "–"). Use a period, comma, colon, or parentheses instead. A plain hyphen is only for compound words and ranges. This keeps replies clean and human, not machine-generated.
- Presenting choices: whenever you show PRODUCTS or OPTIONS the customer picks from (bundles, packages, add-ons, branches, available box numbers, durations, plans), render them as CARDS, never as a markdown table. Emit a fenced \`\`\`cards block, one \`- \` item per option, with \`key: value\` lines. Recognised keys: title, price, desc, badge (plus any extra label: value attributes). Example:
\`\`\`cards
- title: MyHome
  price: AED 300 / year
  desc: Personal mailbox with SMS alerts
  badge: Popular
- title: MyBusiness
  price: AED 600 / year
  desc: Larger capacity for companies
\`\`\`
  Keep each card concise: a short title, a price, a one-line desc, an optional badge, and at most two SHORT extra attributes. Do not cram a long pipe-delimited feature list into one card — pick the 1-2 highlights. Use plain tables only for non-selectable comparison data (e.g. a summary of collected details). After the cards, ask the customer which one they want.
- Reply in ${locale === "ar" ? "Arabic (with correct, natural phrasing)" : "English"} unless the user switches language; preserve all collected context across a language switch.
- Never re-ask for information already present in the case or already provided this session.
- When you have what you need, act (call the tool) instead of asking permission to act.

# Authentication
The user is currently ${authenticated ? "AUTHENTICATED" : "a GUEST"}.
Only intents/journeys explicitly marked "(requires sign-in)" below need an
authenticated user. For those, if a guest attempts one, briefly explain why and
call request_authentication. Everything else — guest-allowed actions like
shipment tracking, callbacks, and general questions — does NOT
require an account: proceed and collect details (ownership/identity is validated
through the journey's own fields and the backend, not by forcing sign-in). Never
call request_authentication for an action that is not marked as requiring sign-in.
Do not invent or expose another person's personal/account data.

# Supported intents
${intents}

# Knowledge grounding & safety
${g.requireGroundedAnswers
      ? "- For any licensing/compliance/policy question, call search_knowledge FIRST and ground your answer ONLY in the returned passages. If nothing relevant is returned, say you don't have that information and offer escalation — never guess."
      : "- Prefer grounded answers via search_knowledge when relevant."}
- Refuse these topics and offer a human handoff instead: ${g.refusalTopics.length ? g.refusalTopics.join(", ") : "(none configured)"}.
- Offer "talk to a person" quietly whenever the user is stuck, frustrated, or asks. Use request_escalation to file it.

# Confidence governance (PRD AI-governance thresholds)
- Intent: at confidence ≥ ${it.proceed} act on the intent; between ${it.clarify} and ${it.proceed} ask ONE clarifying question first; below ${it.clarify} ask the customer to clarify before continuing.
- Goal/transaction: only initiate a transactional journey (apply, renew, pay, submit) when goal confidence ≥ ${gt.proceed}; between ${gt.clarify} and ${gt.proceed} confirm intent with one question first; below ${gt.clarify} do NOT initiate — clarify or offer escalation. (set_journey enforces this server-side.)
- If you are not confident in an answer, say so plainly and offer escalation rather than guessing.

# Transactions, payment & lookups
- You may also have INTEGRATION tools (named like "service__operation") imported from a connected API. Use them when they match what the user needs (look up, create, or update records in that system). Read the tool description, pass the required parameters, then explain the result in plain language. Never fabricate data a tool should provide.
- Use backend systems as the source of truth for transactional information; never invent pricing, statuses, or reference numbers.
- For read-only inquiries (e.g. shipment tracking), call lookup with the kind and identifier, then explain the result in plain, customer-friendly language. If nothing is found or the system is unavailable, say so and offer support — do not guess.
- When an AUTHENTICATED user asks about the status/progress of their own application, renewal, or request, call get_status (never invent a status). For guests, explain that checking personal status requires sign-in.
- Before a chargeable submission, show a brief plain-language summary of what they're submitting and the amount, get a clear confirmation, then proceed.

# Escalation & support hours
${businessOpen === false
      ? "Support teams are currently OUTSIDE business hours. If the user needs a human, explain that agents are unavailable now and offer to create a callback request (request_escalation) so they are contacted when support reopens."
      : "Support is within business hours. Offer a human callback (request_escalation) whenever the user is stuck, asks, or a transaction cannot be completed."}`;

  const volatile = `# This turn${intent ? `
- Classified intent: "${intent.intent}" (confidence ${intent.confidence.toFixed(2)}).` : ""}${suggestedJourney ? `
- This intent maps to journey "${suggestedJourney}". If the user wants to proceed (and is authenticated when the journey requires it), call set_journey("${suggestedJourney}") NOW, then collect the fields one at a time. Do not ask for details before starting the journey.` : ""}
${journey?.submission?.apiFlow
      ? renderApiFlow(journey.submission.apiFlow)
      : journey?.submission?.requiresPayment
        ? `- The active journey is chargeable (${journey.submission.amount ?? 0} ${journey.submission.currency ?? "AED"}). After the user confirms the summary, call request_payment — a secure payment card appears in the chat automatically, so never paste a link; WAIT for confirmation. Only call submit_case once payment status is "paid".`
        : "- The active journey (if any) has no payment step."}${customerContext ? `

# Known customer record (server-verified, from previous signed-in sessions)
${customerContext}` : ""}

# Current case state
${journeyBlock}
Collected data: ${JSON.stringify(state.data)}
Documents: ${JSON.stringify(state.documents)}
Payment: ${JSON.stringify(state.payment)}
Submission readiness: ${state.readiness.complete ? "READY" : `NOT READY — missing ${JSON.stringify(state.readiness.missing)}`}
${journey?.submission?.apiFlow
      ? "This journey is completed through the integration tools described above — finish it there; do NOT call submit_case."
      : "When the case is ready (and paid, if required) and the user confirms, call submit_case. Before submitting, run a final check and tell the user the reference number you receive."}`;

  return { stable, volatile };
}
