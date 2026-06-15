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

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const system = buildSystemPrompt(agent, state, locale, authenticated, input.businessOpen);
      const stream = client.messages.stream({
        model,
        max_tokens: 1500,
        system,
        tools,
        messages,
      });

      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          yield { type: "text", delta: ev.delta.text };
        }
      }

      const final = await stream.finalMessage();
      messages.push({ role: "assistant", content: final.content });

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
