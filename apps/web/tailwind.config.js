/*
 * Tailwind wired directly to @mezan/ui's CSS custom properties
 * (packages/ui/src/tokens/tokens.css) so every utility class stays in sync
 * with the token source of truth -- no color/radius/shadow/type values are
 * duplicated here.
 *
 * RTL-first: Tailwind's built-in logical-property utilities (ps-, pe-,
 * ms-, me-, start-, end-) are used throughout the design system instead of
 * pl-, pr-, left-, right- utilities, which `pnpm lint:rtl` forbids.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        ink: "var(--text)",
        "ink-muted": "var(--text-muted)",
        "ink-faint": "var(--text-faint)",
        chrome: {
          DEFAULT: "var(--chrome)",
          2: "var(--chrome-2)",
          ink: "var(--chrome-ink)",
          "ink-muted": "var(--chrome-ink-muted)",
          border: "var(--chrome-border)",
          hover: "var(--chrome-hover)",
          active: "var(--chrome-active)",
          accent: "var(--chrome-accent)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          strong: "var(--brand-strong)",
          soft: "var(--brand-soft)",
          ink: "var(--brand-ink)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          strong: "var(--accent-strong)",
          soft: "var(--accent-soft)",
          bright: "var(--accent-bright)",
          ink: "var(--accent-ink)",
        },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)", ink: "var(--success-ink)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)", ink: "var(--warning-ink)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)", ink: "var(--danger-ink)", on: "var(--danger-on)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)", ink: "var(--info-ink)" },
        scrim: "var(--scrim)",
        "chart-1": "var(--chart-1)",
        "chart-2": "var(--chart-2)",
        "chart-3": "var(--chart-3)",
        "chart-4": "var(--chart-4)",
        "chart-5": "var(--chart-5)",
        "chart-6": "var(--chart-6)",
      },
      borderRadius: {
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        pill: "var(--r-pill)",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
        chrome: "var(--shadow-chrome)",
      },
      fontSize: {
        "2xs": ["var(--fs-2xs)", { lineHeight: "1.45" }],
        xs: ["var(--fs-xs)", { lineHeight: "1.45" }],
        sm: ["var(--fs-sm)", { lineHeight: "1.5" }],
        md: ["var(--fs-md)", { lineHeight: "1.55" }],
        base: ["var(--fs-base)", { lineHeight: "1.6" }],
        lg: ["var(--fs-lg)", { lineHeight: "1.5" }],
        xl: ["var(--fs-xl)", { lineHeight: "1.35" }],
        "2xl": ["var(--fs-2xl)", { lineHeight: "1.25" }],
        "3xl": ["var(--fs-3xl)", { lineHeight: "1.2" }],
      },
      fontFamily: {
        ar: "var(--font-ar)",
        body: "var(--font-body)",
        display: "var(--font-display)",
        sig: "var(--font-sig)",
        lat: "var(--font-lat)",
        mono: "var(--font-mono)",
      },
    },
  },
  plugins: [],
};
