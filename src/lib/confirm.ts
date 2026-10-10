import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useIsAppActive } from "@/lib/app-active";
import { persistStorage } from "@/core/secure-kv";
import type { CommandId } from "@/core/types";

/** Need biometric or press-and-hold confirmation. */
export const SENSITIVE = new Set<CommandId>(["unlock", "trunk_open", "engine_start", "windows_open"]);

// Loaded lazily: builds without the native module (Expo Go, older dev builds) fall back
// to press-and-hold instead of crashing at import.
const LA = (
  requireOptionalNativeModule("ExpoLocalAuthentication")
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("expo-local-authentication")
    : null
) as typeof import("expo-local-authentication") | null;

const useBiometricsStore = create(() => ({ isReady: false, name: "Face ID" }));

// Checked at startup and again on returning to the app: Face ID may have been set up in Settings.
function checkBiometrics() {
  if (!LA) return;
  Promise.all([LA.hasHardwareAsync(), LA.isEnrolledAsync(), LA.supportedAuthenticationTypesAsync()])
    .then(([hw, enrolled, types]) => {
      const T = LA!.AuthenticationType;
      const name =
        Platform.OS !== "ios" ? "Biometrics" : types.includes(T.FACIAL_RECOGNITION) ? "Face ID" : types.includes(T.FINGERPRINT) ? "Touch ID" : "Biometrics";
      useBiometricsStore.setState({ isReady: hw && enrolled, name });
    })
    .catch(() => {});
}
checkBiometrics();
useIsAppActive.subscribe((active) => active && checkBiometrics());

export const useBiometrics = () => useBiometricsStore();

const useRequired = create<{ isRequired: boolean }>()(
  persist((): { isRequired: boolean } => ({ isRequired: true }), { name: "pref.requireBiometrics", storage: persistStorage }),
);

export const useIsBiometricsRequired = () => useRequired((s) => s.isRequired);

export function setBiometricsRequired(isRequired: boolean) {
  useRequired.setState({ isRequired });
}

/** Falls back to the device passcode. */
export async function confirmWithBiometrics(reason: string) {
  if (!LA) return false;
  const res = await LA.authenticateAsync({ promptMessage: reason, cancelLabel: "Cancel" });
  return res.success;
}

/** How sensitive commands are confirmed: biometrics when set up and wanted, else press and hold. */
export function useConfirmMode(): "biometric" | "hold" {
  const { isReady } = useBiometrics();
  const isWanted = useIsBiometricsRequired();
  return isReady && isWanted ? "biometric" : "hold";
}
