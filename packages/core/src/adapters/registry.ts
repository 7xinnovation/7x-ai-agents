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
  LookupAdapter,
} from "./types";

type Capability = keyof AdapterBundle;

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
