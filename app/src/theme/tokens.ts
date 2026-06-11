/**
 * Design tokens — the ONE code source for color / spacing / radius / type
 * values (docs/ui-guidelines.md, D-#61). The guideline doc and this module are
 * a TWO-PLACE SYNC: a value changes in §3–§6 of the doc AND here, or in
 * neither. Screen code never hard-codes a hex or an off-scale size.
 *
 * The hex tables live in palette.json so tailwind.config.js (NativeWind,
 * ADR-010/014) maps the same values when it is re-enabled — never a second
 * palette.
 */
import palette from "./palette.json";

/** §3 — light theme. `success` reuses the primary family per the doc. */
export const lightColors = { ...palette.light, success: palette.light.primary };

export type ThemeColors = typeof lightColors;

/** §4 — dark theme. Same token names; values swap. Components never branch on scheme. */
export const darkColors: ThemeColors = { ...palette.dark, success: palette.dark.primary };

/** §6 — corner radius: 8 small badges, 12 cards/buttons/inputs, pill chips. */
export const radius = { sm: 8, md: 12, pill: 999 } as const;

/**
 * §6 — 4dp base spacing. The sanctioned scale is 4/8/12/16/24/32, i.e.
 * space(1|2|3|4|6|8). Fractional steps are off-scale — do not use them.
 */
export const space = (n: number): number => n * 4;

/**
 * §5 — Noto Sans Bengali everywhere (loaded in App.tsx via expo-font).
 * Weights are separate faces; styles set fontFamily, never fontWeight, so
 * Android does not apply a synthetic bold on top of a real bold face.
 */
export const fonts = {
  regular: "NotoSansBengali_400Regular",
  medium: "NotoSansBengali_500Medium",
  bold: "NotoSansBengali_700Bold",
} as const;

/** §5 — type scale (sp; OS font scaling stays enabled). */
export const typeScale = {
  pageTitle: { fontSize: 22, lineHeight: 30, fontFamily: fonts.bold },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.bold },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fonts.regular },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontFamily: fonts.bold },
  secondary: { fontSize: 14, lineHeight: 21, fontFamily: fonts.regular },
  button: { fontSize: 16, lineHeight: 24, fontFamily: fonts.medium },
  chip: { fontSize: 14, lineHeight: 20, fontFamily: fonts.medium },
  caption: { fontSize: 12, lineHeight: 18, fontFamily: fonts.regular },
} as const;

/** §6 — web/desktop renders the phone layout centered at this max width. */
export const MAX_CONTENT_WIDTH = 720;
