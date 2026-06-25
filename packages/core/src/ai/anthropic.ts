import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

/**
 * Returns an Anthropic SDK client. Prefers Azure AI Foundry's native Anthropic
 * Messages API passthrough when AZURE_ANTHROPIC_* are set (the SDK appends
 * /v1/messages to baseURL and sends the key as the x-api-key + anthropic-version
 * headers Azure expects), so the whole orchestrator — streaming, tool use,
 * prompt caching — runs unchanged through Azure. Falls back to the direct
 * Anthropic API when only ANTHROPIC_API_KEY is configured.
 */
export function getAnthropic(): Anthropic {
  if (!_client) {
    const azBase = process.env.AZURE_ANTHROPIC_ENDPOINT;
    const azKey = process.env.AZURE_ANTHROPIC_API_KEY;
    if (azBase && azKey) {
      _client = new Anthropic({ baseURL: azBase.replace(/\/$/, ""), apiKey: azKey });
    } else if (process.env.ANTHROPIC_API_KEY) {
      _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    } else {
      throw new Error("No Anthropic credentials configured (set AZURE_ANTHROPIC_ENDPOINT + AZURE_ANTHROPIC_API_KEY, or ANTHROPIC_API_KEY)");
    }
  }
  return _client;
}

export function resolveModel(agentModel?: string): string {
  return agentModel ?? process.env.DIALOG_MODEL ?? "claude-sonnet-4-6";
}

export function fastModel(): string {
  return process.env.DIALOG_FAST_MODEL ?? process.env.DIALOG_MODEL ?? "claude-sonnet-4-6";
}
