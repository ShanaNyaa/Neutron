import type { ProviderDefinition } from "@/core/provider";

const registry = new Map<string, ProviderDefinition>();

/** Called once at startup from `src/providers/index.ts`; core itself never imports a provider. */
export function registerProviders(list: ProviderDefinition[]) {
  for (const p of list) registry.set(p.id, p);
}

export const listProviders = () => [...registry.values()];
export const getProvider = (id: string) => registry.get(id);
