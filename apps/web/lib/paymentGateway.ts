import type { AgentDefinition } from "@dialog/config";
import { resolveAdapters, adapterContext } from "@dialog/core";
import type { PaymentChoice } from "@dialog/core";

/**
 * The gateway that took a given payment, and the context for talking to it.
 *
 * Three places ask a gateway what happened to a payment — the status probe the
 * widget polls, the return route the customer lands on, and the reconcile
 * sweep. Before an agent could have more than one gateway they all reached for
 * `adapters.payment`, which is now simply the wrong question: a UAEPay payment
 * asked about through N-Genius gets a shrug, and a shrug is read as "still
 * waiting" for ever.
 *
 * `provider` is what the payment row recorded when the money was taken. Null —
 * every payment older than 2 October 2026 — means the agent's default binding,
 * which is what those payments used.
 */
export function gatewayForPayment(
  def: AgentDefinition,
  provider: string | null | undefined
): { choice: PaymentChoice; ctx: ReturnType<typeof adapterContext> } | undefined {
  const adapters = resolveAdapters(def);
  const want = String(provider ?? "").trim().toLowerCase();
  if (want) {
    for (const [method, binding] of Object.entries(def.integrations.paymentGateways ?? {})) {
      if (String(binding.provider).toLowerCase() !== want) continue;
      const choice = adapters.paymentFor?.(method);
      if (choice) return { choice, ctx: adapterContext(def, choice.binding) };
    }
  }
  // Either no provider was recorded, or it is the agent's default one.
  if (!adapters.payment) return undefined;
  return {
    choice: { adapter: adapters.payment, binding: def.integrations.payment, method: "default" },
    ctx: adapterContext(def, def.integrations.payment),
  };
}
