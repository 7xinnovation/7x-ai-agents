import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export function resolveModel(agentModel?: string): string {
  return agentModel ?? process.env.DIALOG_MODEL ?? "claude-opus-4-8";
}

export function fastModel(): string {
  return process.env.DIALOG_FAST_MODEL ?? "claude-haiku-4-5-20251001";
}
