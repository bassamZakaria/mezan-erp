/// <reference types="vite/client" />
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ScreenKey } from "./App";

/** An optional "do this on arrival" hint carried alongside a navigation. */
export type ScreenIntent = "create";

type NavigationValue = {
  navigate: (screen: ScreenKey, intent?: ScreenIntent) => void;
  intent: ScreenIntent | null;
  clearIntent: () => void;
};

const NavigationContext = createContext<NavigationValue | null>(null);

export function NavigationProvider({ value, children }: { value: NavigationValue; children: ReactNode }) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

const FALLBACK: NavigationValue = {
  navigate: (screen) => {
    if (import.meta.env.DEV) console.warn(`navigate(${screen}) called outside <NavigationProvider> — no-op`);
  },
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
  const { intent, clearIntent } = useNavigation();
  const handler = useRef(onIntent);
  handler.current = onIntent;

  useEffect(() => {
    if (!intent) return;
    handler.current(intent);
    clearIntent();
  }, [intent, clearIntent]);
}
