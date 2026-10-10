import type { ProviderDefinition } from "@/core/provider";
import { registerProviders } from "@/core/registry";
import { demoProvider } from "@/providers/demo";
import { hondaProvider } from "@/providers/honda";
import { protonProvider } from "@/providers/proton";

export const providers: ProviderDefinition[] = [protonProvider, hondaProvider, demoProvider];
registerProviders(providers);

export { getProvider } from "@/core/registry";
