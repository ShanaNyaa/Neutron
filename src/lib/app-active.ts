import { AppState } from "react-native";
import { create } from "zustand";

/** Whether the app is in the foreground. */
export const useIsAppActive = create(() => AppState.currentState === "active");

AppState.addEventListener("change", (state) => useIsAppActive.setState(state === "active", true));
