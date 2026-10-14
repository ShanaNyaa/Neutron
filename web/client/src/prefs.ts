import { useSyncExternalStore } from "react";

/**
 * Per-device display preferences, kept in localStorage. One store, so every component that
 * reads a preference updates together when Settings changes it.
 */
export type TyreUnit = "psi" | "kPa" | "bar";
export type PickerStyle = "wheel" | "slider" | "dial";
export type Prefs = { tyreUnit: TyreUnit; pickerStyle: PickerStyle };

const KEY = "mottokar.prefs";
// Most Malaysian tyre placards and petrol-station pumps read PSI.
const DEFAULTS: Prefs = { tyreUnit: "psi", pickerStyle: "wheel" };

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // kept for this visit only
  }
  listeners.forEach((l) => l());
}

export function usePrefs() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export const TYRE_UNITS: { value: TyreUnit; label: string }[] = [
  { value: "psi", label: "PSI" },
  { value: "kPa", label: "kPa" },
  { value: "bar", label: "bar" },
];

/** Proton reports tyre pressure in kPa. */
export function pressure(kpa: number | undefined, unit: TyreUnit) {
  if (kpa == null) return "—";
  if (unit === "psi") return `${Math.round(kpa * 0.1450377)}`;
  if (unit === "bar") return (kpa / 100).toFixed(1);
  return `${Math.round(kpa)}`;
}

export const PICKER_STYLES: { value: PickerStyle; label: string; hint: string }[] = [
  { value: "wheel", label: "Wheel", hint: "Scroll a drum, like a car's climate panel" },
  { value: "slider", label: "Slider", hint: "Drag along a track" },
  { value: "dial", label: "Dial", hint: "Swipe a ruler left and right" },
];

export const unitLabel = (unit: TyreUnit) => TYRE_UNITS.find((u) => u.value === unit)!.label;
