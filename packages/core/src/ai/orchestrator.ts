import type Anthropic from "@anthropic-ai/sdk";
import type { AgentDefinition, CaseState, Locale } from "@dialog/config";
import type { AdapterBundle } from "../adapters/types";
import { getAnthropic, resolveModel, fastModel } from "./anthropic";
import { buildSystemPrompt } from "./prompt";
import { TOOL_DEFS, dispatchTool } from "./tools";
import { findJourney } from "../case/engine";

/**
 * Detect a successful apiFlow submission from a Salesforce-style composite (or
 * plain success) tool result. The gateway always returns HTTP 200, so we judge
 * by the body: at least one success marker and no rollback / failure marker.
 * Returns a reference id (first Salesforce-style record id) when successful.
 */
export function submissionReference(result: string): string | null {
  // "IsSuccess": false is Emirates Post's way of saying it; "success": false is
  // Salesforce's. Neither is a submission, whatever else the body carries.
  if (/"(?:is)?success"\s*:\s*false/i.test(result) || /rolled back/i.test(result)) return null;

  // EMIRATES POST DOES NOT SAY "success".
  //
  // This test was written for EPGL's Salesforce composite, whose response says
  // so outright. Emirates Post's Rental/Save and Guest/Renewal/Save answer with
  // {"payload":{"orderNo":"260972889", …}} and no such field — so every rental
  // and every renewal failed the very first line of this function, no submission
  // was ever surfaced, and everything hanging off one was silently absent:
  // case_submitted, journey.completed, the completion rate on the dashboard, and
  // the ops emails to the branch and the EMX team.
  //
  // Measured on production on 8 September: 20 journeys started, one payment of
  // AED 695 taken and recorded, and zero submissions.
  //
  // Their order number IS the reference — it is what the customer is given and
  // what Emirates Post files the rental under.
  // Quoted or bare, but never null: a refused save carries "orderNo": null, and
  // reading that as a reference would report a submission that did not happen.
  const order = /"order(?:No|Number)"\s*:\s*"?([A-Za-z0-9-]{4,40})"?/i.exec(result)?.[1];
  if (order && !/^null$/i.test(order)) return order;

  if (!/"success"\s*:\s*true/i.test(result)) return null;

  // Take the LICENCE REQUEST's own id, not an incidental one (Account, Contact,
  // a document…). Everything downstream hangs off this: the reference shown to
  // the customer, and the parent every uploaded file is attached to.
  //
  // This used to scan the text for a referenceId mentioning LicenseRequest and
  // take the nearest id BEFORE it — which assumes the item serialises as
  // {"body":{"id":…},"referenceId":…}. It is a custom Apex resource, so the
  // field order is theirs to choose, and when referenceId comes first the
  // "nearest preceding id" belongs to the PREVIOUS item. On 2 Sep that is
  // exactly what happened: LR-37176 was created as a11FW000Uygg8hsYIA and we
  // recorded a3jFW0001wOjRySYAV, so both of the customer's documents were
  // attached to some other record and the application looked empty.
  //
  // So the response is parsed, and each item's id is read from that item.
  const idOf = (item: unknown): string | null => {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const body = (o.body ?? o) as Record<string, unknown>;
    for (const v of [body?.id, body?.Id, o.id, o.Id]) {
      if (typeof v === "string" && /^[a-zA-Z0-9]{15,18}$/.test(v)) return v;
    }
    return null;
  };
  const refOf = (item: unknown): string =>
    typeof (item as Record<string, unknown>)?.referenceId === "string"
      ? String((item as Record<string, unknown>).referenceId)
      : "";

  // The tool result is a status line followed by the body.
  const brace = result.indexOf("{");
  const bracket = result.indexOf("[");
  const start = brace === -1 ? bracket : bracket === -1 ? brace : Math.min(brace, bracket);
  if (start !== -1) {
    try {
      const parsed = JSON.parse(result.slice(start)) as Record<string, unknown> | unknown[];
      const items = Array.isArray(parsed)
        ? parsed
        : ((parsed as Record<string, unknown>).compositeResponse ??
           (parsed as Record<string, unknown>).results ??
           (parsed as Record<string, unknown>).compositeRequest ??
           []);
      if (Array.isArray(items) && items.length) {
        // Named exactly, then anything mentioning it (the fan-out suffixes an
        // array-bodied item as NewLicenseRequest_0).
        const wanted = items.filter((i) => /licenserequest/i.test(refOf(i)));
        for (const i of wanted) {
          const id = idOf(i);
          if (id) return id;
        }
      }
      // A single-object response with an id and no composite wrapper.
      const flat = idOf(parsed);
      if (flat) return flat;
    } catch {
      /* fall through to the text scan below */
    }
  }

  // Unparseable body: pair each referenceId with the id in the SAME item by
  // splitting on item boundaries rather than guessing at a distance.
  for (const chunk of result.split(/\}\s*,\s*\{/)) {
    if (!/"referenceId"\s*:\s*"[^"]*licenserequest/i.test(chunk)) continue;
    const id = chunk.match(/"id"\s*:\s*"([a-zA-Z0-9]{15,18})"/i)?.[1];
    if (id) return id;
  }
  // Nothing identifiable. The submission still happened, so it is still
  // reported — but with a marker rather than some other record's id. The
  // document upload requires a Salesforce-shaped id, so it skips rather than
  // attaching the customer's files to a stranger. Returning a plausible-looking
  // wrong id is the failure mode this whole function exists to avoid.
  return "submitted";
}

export interface TurnMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RunTurnInput {
  agent: AgentDefinition;
  agentId: string;
  caseId: string;
  history: TurnMessage[];
  userMessage: string;
  case: CaseState;
  locale: Locale;
  authenticated: boolean;
  userRef?: string;
  adapters: AdapterBundle;
  // Pre-turn intent classification (PRD AI-governance: confidence gating).
  intent?: { intent: string; confidence: number };
  // Same, but classified concurrently with this turn so the first token isn't
  // blocked on a separate model round-trip. Resolved after the first round (by
  // which point it's ready), then used to gate set_journey and nudge later rounds.
  intentPromise?: Promise<{ intent: string; confidence: number } | undefined>;
  // Whether the request is within configured business hours (drives escalation).
  businessOpen?: boolean;
  // Server-verified facts about the signed-in customer (e.g. PO Boxes on file),
  // surfaced in the system prompt so the agent never re-asks for them.
  customerContext?: string;
  // Dynamic tools from the agent's API integrations (imported from OpenAPI).
  extraTools?: Anthropic.Tool[];
  /**
   * `state` is passed because the case as the HOST sees it is a snapshot taken
   * before the turn. Builtin tools like collect_field update the state in this
   * loop, and an integration tool called in the SAME round — the save, right
   * after the preferences are recorded — needs what the customer just chose, not
   * what they had chosen when the request arrived.
   */
  runExtraTool?: (
    name: string,
    input: Record<string, unknown>,
    state: CaseState
  ) => Promise<{ result: string; isError?: boolean }>;
  /**
   * A total the backend has committed to, read fresh each time it is needed —
   * an integration tool may establish it partway through the turn (an Emirates
   * Post hold quotes the real price), so this is a getter, not a value.
   */
  authoritativeAmount?: () => number | null;
  /** Save tools that need a backend reservation, and whether one exists right now. */
  holdBackedSaveTools?: string[];
  holdPresent?: () => boolean;
}

export type OrchestratorEvent =
  | { type: "text"; delta: string }
  | { type: "case"; state: CaseState }
  | { type: "citation"; source: string }
  | { type: "escalation"; reference: string }
  | { type: "auth_required"; reason: string }
  | { type: "payment_initiated"; reference: string; link?: string; amount: number; currency: string }
  | { type: "lookup"; kind: string }
  | { type: "integration"; tool: string }
  | { type: "submitted"; reference: string }
  | { type: "done"; message: string; state: CaseState }
  | { type: "error"; message: string };

const MAX_TOOL_ROUNDS = 6;
// Retries live here rather than in the SDK (see the stream call below). Three
// attempts with ~0.7s / 1.4s / 2.8s backoff rides out a brief throttle in a few
// seconds; anything longer is a capacity problem that waiting cannot fix, and a
// prompt failure beats a two-minute spinner.
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 700;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Total time a single turn may spend WAITING on retries. Chosen so a brief
 * throttle recovers without the customer noticing much, while a sustained one
 * fails fast: waiting cannot create capacity, and a two-minute spinner is worse
 * than a prompt "we're busy".
 */
const RETRY_BUDGET_MS = 20_000;
/**
 * The longest a single wait may be.
 *
 * Azure answers a 429 with retry-after 60s. Honouring that spent the entire
 * budget on one sleep and left room for exactly one retry; capping it turns the
 * same budget into several attempts, which is what a passing spike needs.
 */
const MAX_SINGLE_WAIT_MS = 4_000;
/** A little room to try the other deployment once. */
const FALLBACK_BUDGET_MS = 4_000;

/**
 * How long the provider asked us to wait, in ms, if it said so — either via the
 * retry-after header or the message body (Azure phrases it as "Please wait N
 * seconds before retrying"). Undefined when there is no usable hint.
 */
function retryAfterMs(err: unknown): number | undefined {
  const e = err as { headers?: Record<string, string>; message?: string } | undefined;
  const header = e?.headers?.["retry-after"];
  if (header && /^\d+$/.test(header.trim())) return Number(header.trim()) * 1000;
  const m = /wait\s+(\d+)\s+seconds?/i.exec(e?.message ?? "");
  return m ? Number(m[1]) * 1000 : undefined;
}

/** Transient API failures worth retrying (overload, rate limit, gateway, network). */
function isTransient(err: unknown): boolean {
  const e = err as { status?: number; name?: string } | undefined;
  if (!e) return false;
  if (typeof e.status === "number" && [408, 409, 429, 500, 502, 503, 504, 529].includes(e.status)) return true;
  const n = (e.name ?? "").toLowerCase();
  return n.includes("connection") || n.includes("timeout") || n.includes("overloaded");
}

/**
 * One conversational turn. Streams assistant text, runs any tool calls against
 * the case engine + adapters, emits case/citation/escalation events, and loops
 * until the model produces a final answer. Yielded events are transport-agnostic
 * (the web app maps them to SSE).
 */
/**
 * Resolve `p`, or give up after `ms` and return undefined. The promise is left
 * running (its result is simply ignored) and its rejection is swallowed, so an
 * abandoned best-effort call can never surface as an unhandled rejection.
 */
async function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.catch(() => undefined),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function* runTurn(input: RunTurnInput): AsyncGenerator<OrchestratorEvent> {
  const { agent, locale, authenticated } = input;
  let state = input.case;
  // Intent may arrive after the turn starts (classified concurrently). Resolved
  // once, after the first round streams, so the first token isn't blocked on it.
  let intent = input.intent;
  let pendingIntent = input.intentPromise;

  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
    { role: "user", content: input.userMessage },
  ];

  const client = getAnthropic();
  // Not const: a turn that runs out of retries on the main deployment finishes
  // on the other one rather than failing in front of the customer.
  let model = resolveModel(agent.model);
  let triedFallback = false;
  const builtin = new Set(TOOL_DEFS.map((t) => t.name));
  const tools = input.extraTools?.length ? [...TOOL_DEFS, ...input.extraTools] : TOOL_DEFS;
  // Mark the last tool definition cacheable so the (static) tool schema is reused
  // across tool rounds via Anthropic prompt caching instead of re-sent each round.
  const cachedTools = tools.map((t, i) =>
    i === tools.length - 1 ? ({ ...t, cache_control: { type: "ephemeral" } } as unknown as Anthropic.Tool) : t
  );

  // When the model emits text, calls a tool, then emits more text in a later
  // round, the two text runs would otherwise concatenate with no break (e.g.
  // "…right away!To look up…"). Insert a paragraph separator before the next
  // round's first text so the segments read as distinct messages.
  let retryBudgetMs = RETRY_BUDGET_MS;
  let pendingSeparator = false;
  // Emit at most one apiFlow submission per turn (a successful saveTool call).
  let submittedThisTurn = false;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Re-read every round: the customer can add an agent or ask for key
      // delivery mid-turn, and the total they are quoted has to move with it.
      const sys = buildSystemPrompt(
        agent, state, locale, authenticated, input.businessOpen, intent, input.customerContext,
        input.authoritativeAmount?.() ?? null
      );
      // Split system: cacheable stable prefix + small volatile tail (case state).
      // cache_control is accepted by the GA messages endpoint at runtime; the
      // SDK 0.32 GA types don't surface it yet, hence the cast.
      const system = [
        { type: "text", text: sys.stable, cache_control: { type: "ephemeral" } },
        { type: "text", text: sys.volatile },
      ] as unknown as Anthropic.TextBlockParam[];

      // Create + stream the round, retrying transient API errors as long as no
      // assistant text has been emitted yet this round (safe to restart).
      let final: Anthropic.Message;
      let attempt = 0;
      for (;;) {
        let textStarted = false;
        try {
          const stream = client.messages.stream({
            model,
            // 1500 was not enough, and the way it failed was invisible. EPGL's
            // submission is ONE tool call carrying a composite -- an Account,
            // every partner, a contact, a member and a row per uploaded document
            // -- which runs to thousands of tokens of JSON. The model wrote "Got
            // it, submitting your application now", began the tool call, hit the
            // ceiling, and the round ended with stop_reason "max_tokens". Nothing
            // errored: the turn just finished, having done nothing, and the
            // customer sat there asking "are you submitting?".
            //
            // Sized for that composite with room to spare. It is a CEILING, not a
            // target: a short answer still costs one short answer.
            max_tokens: 8000,
            system,
            tools: cachedTools,
            messages,
          }, {
            // The SDK's own retries are DISABLED here because they stack with the
            // loop below: on a 429 the SDK honours Azure's retry-after (60s) up to
            // maxRetries, and then this loop retries the whole round and does it
            // all again. One throttled tool round could burn minutes with the
            // customer watching a spinner (observed: a 42s gap between the tool
            // results and the next token). Retrying is handled here instead, with
            // a bounded backoff measured in seconds.
            maxRetries: 0,
          });
          for await (const ev of stream) {
            if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
              // Break from a prior round's text before this round's first chars.
              if (pendingSeparator && !textStarted) yield { type: "text", delta: "\n\n" };
              pendingSeparator = false;
              textStarted = true;
              yield { type: "text", delta: ev.delta.text };
            }
          }
          final = await stream.finalMessage();
          break;
        } catch (err) {
          if (!textStarted && isTransient(err) && attempt < MAX_RETRIES && retryBudgetMs > 0) {
            attempt++;
            // A throttled provider tells us how long to wait. Honouring a long
            // hint spends the WHOLE budget on one sleep and buys a single retry:
            // Azure answers a 429 with retry-after 60s, we waited the full 20s
            // budget, tried once, and gave up. Several short attempts inside the
            // same budget survive a brief spike, which is what most of these are.
            const hinted = retryAfterMs(err);
            const backoff = RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 120);
            const wait = Math.min(hinted ?? backoff, MAX_SINGLE_WAIT_MS, retryBudgetMs);
            retryBudgetMs -= wait;
            await sleep(wait);
            continue;
          }
          // Out of retries on the main model, and the customer is mid-purchase.
          // A second deployment has its own quota, so one attempt there beats
          // handing back "the service is busy" and making them type it again.
          if (!textStarted && isTransient(err) && !triedFallback) {
            const alt = fastModel();
            if (alt && alt !== model) {
              triedFallback = true;
              model = alt;
              attempt = 0;
              retryBudgetMs = Math.max(retryBudgetMs, FALLBACK_BUDGET_MS);
              continue;
            }
          }
          throw err;
        }
      }
      messages.push({ role: "assistant", content: final.content });

      // The first round has streamed — resolve the concurrently-running intent
      // classification now so it gates set_journey this round and informs the
      // prompt on later rounds.
      //
      // NEVER block the turn on it. It usually IS ready here, but when the
      // classifier is rate-limited the customer watches a spinner for minutes
      // after their reply was already complete (observed: reply at 2.7s, stream
      // held open to 120s). Intent is an optimisation — without it the journey
      // simply starts a turn later — so it gets a short grace period and is then
      // abandoned.
      if (intent === undefined && pendingIntent) {
        intent = await raceTimeout(pendingIntent, 2500);
        pendingIntent = undefined;
      }

      // If this round produced any assistant text, the next round's text (after
      // the tool runs) needs a separator so they don't run together.
      if (final.content.some((c) => c.type === "text" && c.text.trim().length > 0)) {
        pendingSeparator = true;
      }

      const toolUses = final.content.filter(
        (c): c is Anthropic.ToolUseBlock => c.type === "tool_use"
      );

      // Truncated mid-answer. Whatever the model was building -- most often a
      // large tool call -- is incomplete, so treating this as a finished turn
      // reports work as done that was never started. It is a failure and is
      // raised as one, so it lands in the logs instead of looking like the model
      // simply chose to stop.
      if (final.stop_reason === "max_tokens") {
        const partial = final.content
          .filter((c): c is Anthropic.TextBlock => c.type === "text")
          .map((c) => c.text)
          .join("");
        const attempted = final.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
        yield {
          type: "error",
          message:
            `Response hit the token ceiling before it finished` +
            (attempted ? ` (mid tool call: ${attempted.name})` : "") +
            `. Nothing was submitted.`,
        };
        yield { type: "done", message: partial, state };
        return;
      }

      if (final.stop_reason !== "tool_use" || toolUses.length === 0) {
        const text = final.content
          .filter((c): c is Anthropic.TextBlock => c.type === "text")
          .map((c) => c.text)
          .join("");
        yield { type: "done", message: text, state };
        return;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        // Route integration (non-builtin) tools to the dynamic handler.
        if (!builtin.has(tu.name) && input.runExtraTool) {
          yield { type: "integration", tool: tu.name };
          const r = await input.runExtraTool(tu.name, tu.input as Record<string, unknown>, state);
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: r.result, is_error: r.isError });
          // apiFlow journeys complete through a backend saveTool (e.g. Salesforce
          // submitLicenseRequest), not the internal submit_case. When the active
          // journey's saveTool succeeds, surface it as a submission so completion
          // is tracked in analytics exactly like the internal spine.
          if (!r.isError && !submittedThisTurn) {
            const saveTool = findJourney(agent, state.journeyKey)?.submission?.apiFlow?.saveTool;
            if (saveTool && tu.name === saveTool) {
              const ref = submissionReference(r.result);
              if (ref) { submittedThisTurn = true; yield { type: "submitted", reference: ref }; }
            }
          }
          continue;
        }
        const res = await dispatchTool(tu.name, tu.input as Record<string, unknown>, {
          agent,
          agentId: input.agentId,
          caseId: input.caseId,
          state,
          adapters: input.adapters,
          authenticated,
          userRef: input.userRef,
          locale,
          intent,
          authoritativeAmount: input.authoritativeAmount?.() ?? null,
          holdBackedSaveTools: input.holdBackedSaveTools,
          holdPresent: input.holdPresent?.() ?? false,
        });
        state = res.state;
        for (const e of res.events) {
          if (e.type === "case") yield { type: "case", state: e.state };
          else if (e.type === "citation") yield { type: "citation", source: e.source };
          else if (e.type === "escalation") yield { type: "escalation", reference: e.reference };
          else if (e.type === "auth_required") yield { type: "auth_required", reason: e.reason };
          else if (e.type === "payment_initiated")
            yield { type: "payment_initiated", reference: e.reference, link: e.link, amount: e.amount, currency: e.currency };
          else if (e.type === "lookup") yield { type: "lookup", kind: e.kind };
          else if (e.type === "submitted") yield { type: "submitted", reference: e.reference };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: res.result,
          is_error: res.isError,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
    yield { type: "done", message: "", state };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
