import type { ColorValue } from "react-native";
import { useCSSVariable } from "uniwind";

/**
 * Typed wrapper around `useCSSVariable` that returns a `ColorValue` for use
 * in React Native style props (backgroundColor, tintColor, etc.).
 *
 * Upstream deleted this wrapper when it compiled semantic themes for Uniwind
 * (018d7f277); the fork's screens (MT Teams, voice dictation, SSH prompt)
 * still consume it, so it lives on here.
 *
 * Usage: `const color = useThemeColor("--color-icon");`
 */
export function useThemeColor(variable: `--color-${string}`): ColorValue {
  return useCSSVariable(variable) as string as ColorValue;
}
