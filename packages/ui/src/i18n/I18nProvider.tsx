import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, directionOf, type Direction, type Locale } from "./locale";
import { loadPersistedLocale, persistLocale } from "./storage";
import { translate, type LocaleCatalogs, type MissingKeyReporter, type Translate, type TranslationParams } from "./translate";
import { uiCatalogs, type UiTranslationKey } from "./catalog";

export interface I18nContextValue {
  readonly locale: Locale;
  readonly direction: Direction;
  readonly setLocale: (locale: Locale) => void;
  readonly t: Translate;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  direction: directionOf(DEFAULT_LOCALE),
  setLocale: () => {},
  t: (key, params) => translate(uiCatalogs, DEFAULT_LOCALE, key, params),
});

export interface I18nProviderProps {
  readonly children: ReactNode;
  /** Every locale's strings. Compose with `mergeCatalogs` when several packages contribute keys. */
  readonly catalogs: LocaleCatalogs;
  /** Test seam / SSR override; without it the persisted choice wins, then Arabic. */
  readonly initialLocale?: Locale;
  /** Called for a key the active locale lacks — apps wire this to a dev-only console.error. */
  readonly onMissingKey?: MissingKeyReporter;
}

/**
 * Owns the interface language and, with it, the document direction: `lang` and
 * `dir` are stamped on <html> from the locale alone, so switching language
 * flips RTL/LTR live with no reload and no separately stored direction value.
 */
export function I18nProvider({ children, catalogs, initialLocale, onMissingKey }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? loadPersistedLocale() ?? DEFAULT_LOCALE);
  const direction = directionOf(locale);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("lang", locale);
    root.setAttribute("dir", direction);
  }, [locale, direction]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      direction,
      setLocale,
      t: (key, params) => translate(catalogs, locale, key, params, onMissingKey),
    }),
    [catalogs, direction, locale, onMissingKey, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * The translator for the active locale. Usable without a provider — it then
 * resolves the shared `@mezan/ui` catalog in Arabic, which is what keeps
 * standalone component rendering working.
 */
export function useTranslation(): I18nContextValue {
  return useContext(I18nContext);
}

export interface UiI18nContextValue extends Omit<I18nContextValue, "t"> {
  readonly t: (key: UiTranslationKey, params?: TranslationParams) => string;
}

/** `useTranslation` narrowed to the keys `@mezan/ui` itself ships, so a typo is a type error. */
export function useUiTranslation(): UiI18nContextValue {
  return useTranslation() as UiI18nContextValue;
}
