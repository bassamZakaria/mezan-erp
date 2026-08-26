/// <reference types="vite/client" />
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ScreenKey } from "./App";

/** An optional "do this on arrival" hint carried alongside a navigation. */
export type ScreenIntent = "create";

type NavigationValue = {
  navigate: (screen: ScreenKey, intent?: ScreenIntent) => void;
  /** Sub-page segments under the active screen — `["new"]`, `["<id>"]`, `[]`. */
  segments: readonly string[];
  /** Replace the active screen's sub-page: `openSubPage(["new"])` → `#/sales/quotes/new`. */
  openSubPage: (segments: readonly string[]) => void;
  intent: ScreenIntent | null;
  clearIntent: () => void;
  /**
   * Called by `useScreenIntent` while a screen is mounted, so ⌘N can tell
   * whether the screen on display has a create flow of its own. Returns the
   * deregistration.
   */
  registerIntentTarget?: () => () => void;
};

const NavigationContext = createContext<NavigationValue | null>(null);

export function NavigationProvider({ value, children }: { value: NavigationValue; children: ReactNode }) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

const FALLBACK: NavigationValue = {
  navigate: (screen) => {
    if (import.meta.env.DEV) console.warn(`navigate(${screen}) called outside <NavigationProvider> — no-op`);
  },
  segments: [],
  openSubPage: () => {},
  intent: null,
  clearIntent: () => {},
};

export function useNavigation(): NavigationValue {
  return useContext(NavigationContext) ?? FALLBACK;
}

/**
 * Runs `onIntent` once when a screen is entered with a pending intent, then
 * clears it. Only the active routable screen is mounted, so the pending intent
 * is unambiguously this screen's.
 */
export function useScreenIntent(onIntent: (intent: ScreenIntent) => void): void {
  const { intent, clearIntent, registerIntentTarget } = useNavigation();
  const handler = useRef(onIntent);
  handler.current = onIntent;

  useEffect(() => registerIntentTarget?.(), [registerIntentTarget]);

  useEffect(() => {
    if (!intent) return;
    handler.current(intent);
    clearIntent();
  }, [intent, clearIntent]);
}

/**
 * A screen's own sub-page state, addressed in the URL rather than held in
 * component state: `segments` is what follows the screen's path, `open` pushes
 * a new sub-page, `close` returns to the screen's index.
 */
export function useSubPage(): {
  segments: readonly string[];
  open: (...segments: string[]) => void;
  close: () => void;
} {
  const { segments, openSubPage } = useNavigation();
  return {
    segments,
    open: (...next: string[]) => openSubPage(next),
    close: () => openSubPage([]),
  };
}
