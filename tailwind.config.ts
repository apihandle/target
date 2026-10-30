import type { Config } from "tailwindcss";

/**
 * TARGET design tokens. Night-water neutrals (deep teal-black), one warm accent (TARGET sun-glint gold), semantic status colors.
 * Use these names (bg, surface, line, ink, muted, accent…) instead of raw colors in app UI.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        script: ["var(--font-script)", "Brush Script MT", "cursive"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      colors: {
        background: "var(--background)",
        // venice.ai palette (landing + auth)
        "deep-sea": "#06090d",
        stucco: { DEFAULT: "#eeede4", mid: "#bea989" },
        sea: { DEFAULT: "#125da3", light: "#4898e6", dark: "#0e2942" },
        "sky-accent": "#4898e6",
        "sun-glint": "#e6c487",
        foreground: "var(--foreground)",
        bg: "#05090c",
        surface: { DEFAULT: "#0b1317", 2: "#111c21", 3: "#18252b" },
        line: { DEFAULT: "#1a272d", strong: "#27373e" },
        ink: { DEFAULT: "#eeede4", soft: "#cdd2cc" },
        muted: { DEFAULT: "#94a2a3", soft: "#66777b" },
        accent: { DEFAULT: "#e6c487", strong: "#f0d6a4", ink: "#14100a", subtle: "#231e14" },
        ok: { DEFAULT: "#5fd08a", subtle: "#13261b" },
        warn: { DEFAULT: "#f5c451", subtle: "#2a2310" },
        danger: { DEFAULT: "#f47c7c", subtle: "#2c1517" },
        info: { DEFAULT: "#7fb3f5", subtle: "#121d2c" },
      },
      borderRadius: { xl2: "1.125rem" },
      boxShadow: { card: "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px -16px rgba(0,0,0,0.6)" },
    },
  },
  plugins: [],
};
export default config;
