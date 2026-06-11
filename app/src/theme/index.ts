/**
 * Theme access — components read tokens through these hooks and never branch
 * on the color scheme themselves (docs/ui-guidelines.md §4). The theme follows
 * the OS (`useColorScheme`); a manual in-app toggle is out of scope for v1.
 */
import { StyleSheet, useColorScheme, type TextStyle } from "react-native";
import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";
import { darkColors, fonts, lightColors, type ThemeColors } from "./tokens";

export { darkColors, fonts, lightColors, MAX_CONTENT_WIDTH, radius, space, typeScale } from "./tokens";
export type { ThemeColors } from "./tokens";

/** The active color set for the OS scheme. */
export function useColors(): ThemeColors {
  return useColorScheme() === "dark" ? darkColors : lightColors;
}

/**
 * Theme-aware StyleSheet factory: `const useStyles = makeStyles((c) => ({...}))`
 * then `const styles = useStyles()` inside the component. Sheets are created
 * once per color set and cached.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ThemeColors) => T,
): () => T {
  const cache = new Map<ThemeColors, T>();
  return function useStyles(): T {
    const colors = useColors();
    const hit = cache.get(colors);
    if (hit) return hit;
    const sheet = StyleSheet.create(factory(colors));
    cache.set(colors, sheet);
    return sheet;
  };
}

/**
 * Resolve a text style against the loaded Noto Sans Bengali faces: any
 * `fontWeight` override (the screens' existing emphasis idiom) is mapped to
 * the matching face and the weight is dropped, so Android never stacks a
 * synthetic bold on a real bold face.
 */
export function resolveTextStyle(...styles: (TextStyle | undefined | null | false)[]): TextStyle {
  const flat = StyleSheet.flatten(styles.filter(Boolean) as TextStyle[]) ?? {};
  const { fontWeight, ...rest } = flat;
  if (fontWeight === undefined) return rest.fontFamily ? rest : { ...rest, fontFamily: fonts.regular };
  const numeric = typeof fontWeight === "string" ? Number(fontWeight) : (fontWeight as number);
  const family =
    fontWeight === "bold" || (Number.isFinite(numeric) && numeric >= 600)
      ? fonts.bold
      : Number.isFinite(numeric) && numeric >= 500
        ? fonts.medium
        : fonts.regular;
  return { ...rest, fontFamily: family };
}

/** React Navigation theme built from the same tokens (headers, tab bar, screen bg). */
export function useNavigationTheme(): Theme {
  const dark = useColorScheme() === "dark";
  const c = dark ? darkColors : lightColors;
  const base = dark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.primary,
      background: c.bg,
      card: c.surface,
      text: c.textPrimary,
      border: c.border,
      notification: c.gold,
    },
  };
}
