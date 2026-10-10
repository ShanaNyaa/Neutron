import { create } from "zustand";
import { persist } from "zustand/middleware";

import { persistStorage } from "@/core/secure-kv";

/** Shows the developer tools (Debug Logs, Simulator) in Settings. Nothing else in the app changes. */
const useDeveloperMode = create<{ isEnabled: boolean }>()(
  persist((): { isEnabled: boolean } => ({ isEnabled: false }), { name: "pref.developerMode", storage: persistStorage }),
);

export const useIsDeveloperMode = () => useDeveloperMode((s) => s.isEnabled);

export function setDeveloperMode(isEnabled: boolean) {
  useDeveloperMode.setState({ isEnabled });
}
