import type { AgentDefinition, Locale } from "@dialog/config";
import { tr } from "@dialog/config";
import { getAnthropic, classifierModel, withModelFallback } from "./anthropic";

export interface IntentResult {
  intent: string; // one of the agent's intent keys, or "unknown"
  confidence: number; // 0..1
}

/**
 * Lightweight intent classification on the fast model. Forces a structured tool
 * call so the result is always a valid {intent, confidence}. Used by the eval
 * harness (intent accuracy) and available to the orchestrator/router.
 */
export async function classifyIntent(
  agent: AgentDefinition,
  message: string,
  locale: Locale = "en"
): Promise<IntentResult> {
  const keys = [...agent.intents.map((i) => i.key), "unknown"];
  const list = agent.intents.map((i) => `- ${i.key}: ${tr(i.description, locale)}`).join("\n");

  const client = getAnthropic();
  const res = await withModelFallback(classifierModel(), (model) => client.messages.create({
    model,
    max_tokens: 200,
    system: `You classify a user's message into exactly one supported intent for the assistant "${agent.name}". If none clearly applies, use "unknown". Respond only via the classify tool.\n\nSupported intents:\n${list}`,
    tools: [
      {
        name: "classify",
        description: "Return the single best-matching intent and your confidence.",
        input_schema: {
          type: "object",
          properties: {
            intent: { type: "string", enum: keys },
            confidence: { type: "number", description: "0 to 1" },
          },
          required: ["intent", "confidence"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify" },
    messages: [{ role: "user", content: message }],
  }, {
    // This runs CONCURRENTLY with the customer's actual turn, so it is the call
    // most likely to be rate-limited — and the SDK then honours a 60s
    // retry-after, twice, while the reply sits finished and undelivered. It is
    // best-effort (the caller already swallows failures and the journey can start
    // on the next turn), so it fails fast rather than retrying.
    timeout: 8000,
    maxRetries: 0,
  }));

  const block = res.content.find((c) => c.type === "tool_use");
  if (block && block.type === "tool_use") {
    const input = block.input as { intent?: string; confidence?: number };
    const intent = keys.includes(input.intent ?? "") ? input.intent! : "unknown";
    const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0)));
    return { intent, confidence };
  }
  return { intent: "unknown", confidence: 0 };
}
