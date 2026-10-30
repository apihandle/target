import type { Config } from "tailwindcss";

/**
 * TARGET design tokens. Calm dark neutrals, one warm accent (TARGET orange), semantic status colors.
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
        foreground: "var(--foreground)",
        bg: "#0c0d10",
        surface: { DEFAULT: "#14161b", 2: "#1b1e24", 3: "#23262e" },
        line: { DEFAULT: "#262a32", strong: "#363b45" },
        ink: { DEFAULT: "#eef0f3", soft: "#c9ced6" },
        muted: { DEFAULT: "#9aa1ac", soft: "#6f7682" },
        accent: { DEFAULT: "#f2994a", strong: "#f7b072", ink: "#1a1205", subtle: "#2a1f14" },
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
