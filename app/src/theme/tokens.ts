/**
 * Runtime design tokens — mirror of the Tailwind/NativeWind palette in
 * tailwind.config.js. Components use NativeWind `className` where practical and
 * fall back to these tokens for StyleSheet props that need real values
 * (shadows, dynamic colors), so the UI renders correctly even on surfaces where
 * a utility class is not yet generated.
 */
export const colors = {
  brand50: "#f0fdfa",
  brand100: "#ccfbf1",
  brand500: "#14b8a6",
  brand600: "#0d9488",
  brand700: "#0f766e",
  brand800: "#115e59",
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  bg: "#f8fafc",
  card: "#ffffff",
  white: "#ffffff",
  danger: "#dc2626",
  dangerBg: "#fef2f2",
  warn: "#d97706",
  warnBg: "#fffbeb",
  ok: "#16a34a",
  okBg: "#f0fdf4",
} as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

/** 4px base spacing scale. */
export const space = (n: number): number => n * 4;
