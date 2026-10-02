import type { AgentDefinition, AdapterBinding } from "@dialog/config";
import type {
  AdapterBundle,
  AdapterContext,
  CRMAdapter,
  AuthAdapter,
  KBAdapter,
  StorageAdapter,
  NotificationAdapter,
  PaymentAdapter,
  PaymentChoice,
  LookupAdapter,
} from "./types";

/**
 * The capabilities that are ADAPTERS, named rather than derived.
 *
 * This was `keyof AdapterBundle`, which stopped being true the moment the
 * bundle gained `paymentFor` — a resolver, not an adapter, with no registry and
 * no provider name behind it.
 */
type Capability = "crm" | "auth" | "knowledge" | "storage" | "notifications" | "payment" | "lookup";

type FactoryMap = {
  crm: () => CRMAdapter;
  auth: () => AuthAdapter;
  knowledge: () => KBAdapter;
  storage: () => StorageAdapter;
  notifications: () => NotificationAdapter;
  payment: () => PaymentAdapter;
  lookup: () => LookupAdapter;
};

// provider name -> factory, per capability.
const registries: { [K in Capability]: Map<string, FactoryMap[K]> } = {
  crm: new Map(),
  auth: new Map(),
  knowledge: new Map(),
  storage: new Map(),
  notifications: new Map(),
  payment: new Map(),
  lookup: new Map(),
};

export function registerAdapter<K extends Capability>(
  capability: K,
  provider: string,
  factory: FactoryMap[K]
): void {
  registries[capability].set(provider, factory);
}

/** Resolve all configured adapters for an agent into a ready-to-use bundle. */
export function resolveAdapters(agent: AgentDefinition): AdapterBundle {
  const bundle: AdapterBundle = {};
  const bind = <K extends Capability>(cap: K, binding?: AdapterBinding) => {
    if (!binding) return;
    const factory = registries[cap].get(binding.provider);
    if (!factory) {
      throw new Error(
        `No "${cap}" adapter registered for provider "${binding.provider}" (agent ${agent.slug})`
      );
    }
    // @ts-expect-error capability-indexed assignment is sound by construction
    bundle[cap] = factory();
  };
  bind("crm", agent.integrations.crm);
  bind("auth", agent.integrations.auth);
  bind("knowledge", agent.integrations.knowledge);
  bind("storage", agent.integrations.storage);
  bind("notifications", agent.integrations.notifications);
  bind("payment", agent.integrations.payment);
  bind("lookup", agent.integrations.lookup);

  /**
   * SEVERAL GATEWAYS, CHOSEN PER PAYMENT.
   *
   * Resolved once, here, rather than looked up at each call site: the three
   * places that ask a gateway for a status — /payments/status, /return and the
   * reconcile sweep — must ask the SAME gateway that took the money, and the
   * surest way to guarantee that is for there to be one resolver.
   *
   * A method with no binding of its own falls back to the agent's single
   * `payment`, so every existing agent is unaffected.
   */
  const byMethod = new Map<string, PaymentChoice>();
  for (const [method, binding] of Object.entries(agent.integrations.paymentGateways ?? {})) {
    const factory = registries.payment.get(binding.provider);
    if (!factory) {
      throw new Error(
        `No "payment" adapter registered for provider "${binding.provider}" (agent ${agent.slug}, method "${method}")`
      );
    }
    byMethod.set(method, { adapter: factory(), binding, method });
  }
  if (bundle.payment || byMethod.size) {
    bundle.paymentFor = (method) => {
      const key = String(method ?? "").trim().toLowerCase();
      const chosen = key ? byMethod.get(key) : undefined;
      if (chosen) return chosen;
      if (!bundle.payment) return undefined;
      return { adapter: bundle.payment, binding: agent.integrations.payment, method: key || "default" };
    };
  }
  return bundle;
}

/** Build the per-call adapter context (settings + resolved secrets) from a binding. */
export function adapterContext(
  agent: AgentDefinition,
  binding: AdapterBinding | undefined
): AdapterContext {
  const secrets: Record<string, string | undefined> = {};
  for (const ref of binding?.secretRefs ?? []) secrets[ref] = process.env[ref];
  return {
    agentSlug: agent.slug,
    settings: binding?.settings ?? {},
    secrets,
  };
}
