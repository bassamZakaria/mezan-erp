/// <reference types="vite/client" />
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ScreenKey } from "./App";

/** An optional "do this on arrival" hint carried alongside a navigation. */
export type ScreenIntentKind = "create";

/**
 * A "do this on arrival" hint. `prefill` carries the entity the caller already
 * knows about — the customer behind «إنشاء فاتورة» on a customer's page, the
 * supplier behind «فاتورة مشتريات», the invoice behind «مرتجع جديد» — so the
 * target screen opens its create flow already bound to it instead of asking
 * the user to search for what they just came from
 * (docs/archive/reference-parity/REQUIREMENTS.md R2.11, R3.6, R4.5).
 */
export interface ScreenIntent {
  readonly kind: ScreenIntentKind;
  readonly prefill?: Readonly<Record<string, string>>;
  /**
   * The screen the intent is addressed to. The hash change that moves there is
   * asynchronous, so without this the intent is picked up by whichever screen
   * is still mounted — clicking «تحصيل» on an invoice row fired the invoice
   * screen's own create handler instead of the voucher screen's.
   */
  readonly screen?: string;
}

/** Callers may pass the bare kind; it normalises to `{ kind }`. */
export type ScreenIntentInput = ScreenIntentKind | ScreenIntent;

export function toScreenIntent(input: ScreenIntentInput): ScreenIntent {
  return typeof input === "string" ? { kind: input } : input;
}

type NavigationValue = {
  navigate: (screen: ScreenKey, intent?: ScreenIntentInput) => void;
  /** Sub-page segments under the active screen — `["new"]`, `["<id>"]`, `[]`. */
  segments: readonly string[];
  /** Replace the active screen's sub-page: `openSubPage(["new"])` → `#/sales/quotes/new`. */
  openSubPage: (segments: readonly string[]) => void;
  /**
   * Open ANOTHER screen at a sub-page — the invoice a quote became, the journal
   * entry a document posted, the invoice a return came from. Without this a
   * cross-document link can only reach the target's list and leave the user to
   * find the row again.
   */
  openScreenAt: (screen: ScreenKey, segments: readonly string[]) => void;
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
  openScreenAt: () => {},
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
