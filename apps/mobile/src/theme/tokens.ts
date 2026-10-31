export enum ThemeMode {
  Light = "light",
  Dark = "dark",
}

export interface Palette {
  readonly brand: string;
  readonly brandText: string;
  readonly rail: string;
  readonly railText: string;
  readonly background: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly border: string;
  readonly text: string;
  readonly textMuted: string;
  readonly positive: string;
  readonly negative: string;
  readonly warning: string;
}

const LIGHT: Palette = {
  brand: "#003ce1",
  brandText: "#ffffff",
  rail: "#1e293b",
  railText: "#e2e8f0",
  background: "#f8fafc",
  surface: "#ffffff",
  surfaceMuted: "#f1f5f9",
  border: "#e2e8f0",
  text: "#0f172a",
  textMuted: "#64748b",
  positive: "#15803d",
  negative: "#b91c1c",
  warning: "#b45309",
};

const DARK: Palette = {
  brand: "#4c7dff",
  brandText: "#0b1220",
  rail: "#0f172a",
  railText: "#cbd5e1",
  background: "#0b1220",
  surface: "#111a2e",
  surfaceMuted: "#16213a",
  border: "#25324d",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  positive: "#4ade80",
  negative: "#f87171",
  warning: "#fbbf24",
};

export const PALETTES: Record<ThemeMode, Palette> = {
  [ThemeMode.Light]: LIGHT,
  [ThemeMode.Dark]: DARK,
};

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const TYPE = {
  display: 28,
  title: 20,
  body: 16,
  label: 14,
  caption: 12,
} as const;
