/*
 * Tailwind wired directly to @mezan/ui's CSS custom properties
 * (packages/ui/src/tokens/tokens.css) so every utility class stays in sync
 * with the token source of truth -- no color/radius/shadow values are
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
        },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)", ink: "var(--success-ink)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)", ink: "var(--warning-ink)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)", ink: "var(--danger-ink)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)", ink: "var(--info-ink)" },
        "chart-1": "var(--chart-1)",
        "chart-2": "var(--chart-2)",
        "chart-3": "var(--chart-3)",
        "chart-4": "var(--chart-4)",
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
      },
      fontFamily: {
        ar: "var(--font-ar)",
        display: "var(--font-display)",
        lat: "var(--font-lat)",
        mono: "var(--font-mono)",
      },
    },
  },
  plugins: [],
};
