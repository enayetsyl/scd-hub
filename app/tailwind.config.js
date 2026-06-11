/** @type {import('tailwindcss').Config} */
// NativeWind is wired but its transform is disabled (ADR-010/014; see
// babel.config.js / metro.config.js). When re-enabled it maps onto the SAME
// token source as the runtime theme — app/src/theme/palette.json — never a
// second palette (docs/ui-guidelines.md §2.5).
const palette = require("./src/theme/palette.json");

module.exports = {
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "media",
  theme: {
    extend: {
      colors: palette.light,
    },
  },
  plugins: [],
};
