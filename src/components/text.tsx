import { getLoadedFonts } from "expo-font";
import type { ComponentProps } from "react";
import { Text as RNText, TextInput as RNTextInput } from "react-native";

// Embedded by the expo-font config plugin as one family, weights 400 to 700. Builds made
// before it was added fall back to the system font instead of warning about an unknown family.
export const FONT = "Instrument Sans";
const available = (() => {
  try {
    return getLoadedFonts().some((f) => /Instrument ?Sans/i.test(f));
  } catch {
    return false;
  }
})();
const family = available ? { fontFamily: FONT } : undefined;

export function Text({ style, ...rest }: ComponentProps<typeof RNText>) {
  return <RNText {...rest} style={family ? [family, style] : style} />;
}

export function TextInput({ style, ...rest }: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput {...rest} style={family ? [family, style] : style} />;
}
