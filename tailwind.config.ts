import type { Config } from "tailwindcss";

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
        editorial: ["Newsreader", "Playfair Display", "serif"],
        mono: ["Geist Mono", "JetBrains Mono", "monospace"],
        sans: ["Geist Sans", "Inter", "-apple-system", "sans-serif"],
      },
      colors: {
        background: "var(--background)",
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
        obsidian: {
          surface: "#0e1416",
          dim: "#0e1416",
          bright: "#343a3d",
          lowest: "#090f11",
          low: "#161d1f",
          container: "#1c2427",
          high: "#273034",
        },
        champagne: {
          gold: "#e6e0d4",
          accent: "#c5a059",
          soft: "rgba(197, 160, 89, 0.15)",
          subtle: "rgba(230, 224, 212, 0.15)",
        },
        teal: {
          neon: "#00f0ff",
        },
      },
      borderRadius: {
        xl2: "1.125rem",
        card_large: "24px",
        card_medium: "16px",
        badge_tag: "8px",
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px -16px rgba(0,0,0,0.6)",
        goldGlow: "0 0 25px rgba(197, 160, 89, 0.25)",
        tealGlow: "0 0 20px rgba(0, 240, 255, 0.25)",
      },
    },
  },
  plugins: [],
};
export default config;