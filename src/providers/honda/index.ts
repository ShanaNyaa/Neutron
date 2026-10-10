import { ProviderError, type ProviderDefinition } from "@/core/provider";

const NOT_YET = "Honda CONNECT One isn’t available yet.";

/** Listed as coming soon until the CONNECT One backend is worked out. */
export const hondaProvider: ProviderDefinition = {
  id: "honda",
  name: "Honda CONNECT One",
  description: "Honda City and other CONNECT One cars.",
  isComingSoon: true,
  color: "#cc0000",
  icon: "car-sport",
  capabilities: [],
  commands: [],
  credentialFields: [
    { key: "email", label: "Email", type: "email", placeholder: "you@example.com" },
    { key: "password", label: "Password", type: "password" },
  ],
  async signIn() {
    throw new ProviderError(NOT_YET);
  },
  createClient() {
    throw new ProviderError(NOT_YET);
  },
};
