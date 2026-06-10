/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // SCD Hub brand palette (teal). Mirrored as runtime tokens in src/theme/tokens.ts.
        brand: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
        },
        ink: "#0f172a",
        muted: "#64748b",
        line: "#e2e8f0",
        danger: "#dc2626",
        warn: "#d97706",
        ok: "#16a34a",
      },
    },
  },
  plugins: [],
};
