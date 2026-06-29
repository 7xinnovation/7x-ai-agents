import type Anthropic from "@anthropic-ai/sdk";
import type { AgentDefinition, CaseState, Locale } from "@dialog/config";
import type { AdapterBundle } from "../adapters/types";
import { getAnthropic, resolveModel } from "./anthropic";
import { buildSystemPrompt } from "./prompt";
import { TOOL_DEFS, dispatchTool } from "./tools";

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
  // Whether the request is within configured business hours (drives escalation).
  businessOpen?: boolean;
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
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 400;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
export async function* runTurn(input: RunTurnInput): AsyncGenerator<OrchestratorEvent> {
  const { agent, locale, authenticated } = input;
  let state = input.case;

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
  let pendingSeparator = false;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const sys = buildSystemPrompt(agent, state, locale, authenticated, input.businessOpen, input.intent);
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
          if (!textStarted && isTransient(err) && attempt < MAX_RETRIES) {
            attempt++;
            await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 120));
            continue;
          }
          throw err;
        }
      }
      messages.push({ role: "assistant", content: final.content });

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
          intent: input.intent,
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
