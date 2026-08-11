import type Anthropic from "@anthropic-ai/sdk";
import type { AgentDefinition, CaseState, Locale } from "@dialog/config";
import type { AdapterBundle } from "../adapters/types";
import { getAnthropic, resolveModel } from "./anthropic";
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
  if (!/"success"\s*:\s*true/i.test(result)) return null;
  if (/"success"\s*:\s*false/i.test(result) || /rolled back/i.test(result)) return null;
  // Prefer the LICENSE REQUEST record's id over incidental ids (Account,
  // Contact…) — feedback FB-1444: the confirmation must reference the actual
  // application, not another record. Composite items look like
  // {"body":{"id":"…","success":true},…,"referenceId":"NewLicenseRequest"}, so
  // find the LicenseRequest item and take the nearest preceding id.
  const refMatches = [...result.matchAll(/"referenceId"\s*:\s*"([^"]*LicenseRequest[^"]*)"/gi)];
  for (const m of refMatches) {
    const windowStart = Math.max(0, (m.index ?? 0) - 600);
    const before = result.slice(windowStart, m.index);
    const ids = [...before.matchAll(/"id"\s*:\s*"([a-zA-Z0-9]{15,18})"/g)];
    const nearest = ids[ids.length - 1]?.[1];
    if (nearest) return nearest;
  }
  const id = result.match(/"id"\s*:\s*"([a-zA-Z0-9]{15,18})"/)?.[1];
  return id ?? "submitted";
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
  runExtraTool?: (name: string, input: Record<string, unknown>) => Promise<{ result: string; isError?: boolean }>;
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
  const model = resolveModel(agent.model);
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
      const sys = buildSystemPrompt(agent, state, locale, authenticated, input.businessOpen, intent, input.customerContext);
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
            max_tokens: 1500,
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
            // A throttled provider tells us how long to wait; honour it when it
            // is short rather than guessing, but never spend more than the
            // budget in total — beyond that it is a capacity shortfall, and
            // waiting only turns a fast error into a long silence.
            const hinted = retryAfterMs(err);
            const backoff = RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 120);
            const wait = Math.min(hinted ?? backoff, retryBudgetMs);
            retryBudgetMs -= wait;
            await sleep(wait);
            continue;
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
          const r = await input.runExtraTool(tu.name, tu.input as Record<string, unknown>);
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
