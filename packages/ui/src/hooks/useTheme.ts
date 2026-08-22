import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "mezan:theme";

function applyThemeAttribute(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage unavailable (privacy mode, SSR, tests) — fall back silently.
  }
  return "system";
}

export interface UseThemeResult {
  theme: ThemePreference;
  setTheme: (preference: ThemePreference) => void;
  /** Flips between light and dark; resolves "system" against the OS preference first. */
  toggleTheme: () => void;
}

/**
 * Manages the `[data-theme]` attribute on <html> (packages/ui/src/tokens/tokens.css
 * reacts to it) plus a `prefers-color-scheme` fallback when no explicit
 * preference is stored. "system" removes the attribute entirely so the CSS
 * media query takes over.
 */
export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredPreference);

  useEffect(() => {
    applyThemeAttribute(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore write failures — theme still applies for this session.
    }
  }, [theme]);

  const setTheme = useCallback((preference: ThemePreference) => setThemeState(preference), []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      if (prev === "dark") return "light";
      if (prev === "light") return "dark";
      const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
      return prefersDark ? "light" : "dark";
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
