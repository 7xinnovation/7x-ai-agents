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

/**
 * Model for INTENT CLASSIFICATION.
 *
 * This picks one label from a fixed list through a forced tool call, and it runs
 * concurrently with the customer's own turn — so it wants to be small and quick,
 * and it cannot produce malformed output whatever model runs it. Measured on the
 * live intent sets (2026-08-11): a small model matched or beat the main model on
 * accuracy (NXN 15/15 both; EPGL 12/12 vs 11/12) at roughly half the latency.
 *
 * Defaults to the small model and falls back automatically where it is not
 * deployed, so an environment without it gets "slower", never "broken".
 */
export function classifierModel(): string {
  return process.env.DIALOG_CLASSIFIER_MODEL ?? process.env.DIALOG_FAST_MODEL ?? "claude-haiku-4-5";
}

/**
 * Model for DOCUMENT EXTRACTION.
 *
 * Deliberately NOT tied to DIALOG_FAST_MODEL. Reading a trade licence or an
 * Emirates ID is accuracy-critical — a misread licence number or a hallucinated
 * company name reaches a government submission — and getting it right took
 * dedicated work. It therefore stays on the main model unless someone opts in
 * explicitly, and setting the classifier to a small model can never drag it
 * along by accident.
 */
export function extractionModel(): string {
  return process.env.DIALOG_EXTRACTION_MODEL ?? resolveModel();
}

/**
 * True when an error means "this model is not available here" rather than a
 * transient failure. Azure AI Foundry reports an undeployed model as
 * DeploymentNotFound (404); the direct API uses not_found_error.
 */
function isModelUnavailable(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | undefined;
  if (!e) return false;
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.status === 404 ||
    msg.includes("deploymentnotfound") ||
    msg.includes("does not exist") ||
    msg.includes("not_found_error") ||
    msg.includes("model not found")
  );
}

/**
 * Run a side task (intent classification, document extraction) on the FAST model,
 * falling back to the main model if the fast one is not deployed.
 *
 * Side tasks are latency-sensitive and simple, so they belong on a small model —
 * on the same path a small model answers in roughly half the time. But the fast
 * model is set by environment variable and the deployment behind it is managed
 * elsewhere, so pointing it at a model that has not been deployed must degrade to
 * "slower", never to "broken": extraction silently returning nothing would stop
 * documents auto-filling an application. The fallback is remembered for the
 * process, so the cost is paid once rather than on every call.
 */
const unavailableModels = new Set<string>();

export async function withModelFallback<T>(model: string, run: (model: string) => Promise<T>): Promise<T> {
  const main = resolveModel();
  if (model === main || unavailableModels.has(model)) return run(main);
  try {
    return await run(model);
  } catch (err) {
    if (!isModelUnavailable(err)) throw err;
    unavailableModels.add(model);
    console.warn(
      `[ai] model "${model}" is not deployed on this endpoint — falling back to "${main}" for this task. ` +
      `Deploy it to get the faster path back.`
    );
    return run(main);
  }
}

/** @deprecated prefer withModelFallback(classifierModel(), …) — kept for callers still on the old name. */
export async function withFastModel<T>(run: (model: string) => Promise<T>): Promise<T> {
  return withModelFallback(fastModel(), run);
}
