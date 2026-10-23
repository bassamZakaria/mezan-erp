import {
  DEFAULT_LOCALE,
  I18nProvider,
  loadPersistedLocale,
  mergeCatalogs,
  uiCatalogs,
  useTranslation,
  type I18nContextValue,
  type Locale,
  type TranslationCatalog,
  type TranslationParams,
  type UiTranslationKey,
} from "@mezan/ui";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { webAr, type WebTranslationKey } from "./catalog";

export type { Locale };
export type AppTranslationKey = WebTranslationKey | UiTranslationKey;

const ENGLISH: Locale = "en";

let englishCatalog: TranslationCatalog | null = null;
let englishLoad: Promise<TranslationCatalog> | null = null;

/** Fetches the English strings once; Arabic ships in the entry bundle, English only when someone asks for it. */
export function loadEnglishCatalog(): Promise<TranslationCatalog> {
  englishLoad ??= import("./catalog-en").then(
    ({ webEn }) => (englishCatalog = webEn),
    (error: unknown) => {
      englishLoad = null;
      throw error;
    },
  );
  return englishLoad;
}

/** The English strings if they have arrived — always non-null while the active locale is English. */
export function loadedEnglishCatalog(): TranslationCatalog | null {
  return englishCatalog;
}

function reportMissingKey(key: string, locale: Locale): void {
  if (!import.meta.env.DEV) return;
  console.error(`[i18n] missing "${locale}" translation for key "${key}" — falling back to Arabic.`);
}

/**
 * Wraps the app in the locale context; `dir`/`lang` on <html> follow from it.
 *
 * The locale only ever flips once its strings are in hand: a saved English
 * preference renders nothing until the English catalogue arrives, and a switch
 * to English keeps the Arabic screen until then — never English chrome around
 * Arabic text, never a raw key.
 */
export function AppI18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [english, setEnglish] = useState(englishCatalog);
  const [bootLocale, setBootLocale] = useState<Locale>(() => initialLocale ?? loadPersistedLocale() ?? DEFAULT_LOCALE);
  const waitingForEnglish = bootLocale === ENGLISH && english === null;

  useEffect(() => {
    if (!waitingForEnglish) return;
    loadEnglishCatalog().then(setEnglish, () => setBootLocale(DEFAULT_LOCALE));
  }, [waitingForEnglish]);

  const catalogs = useMemo(() => mergeCatalogs(uiCatalogs, { ar: webAr, en: english ?? {} }), [english]);
  const ensureCatalog = useCallback(
    (locale: Locale) => (locale === ENGLISH && english === null ? loadEnglishCatalog().then(setEnglish) : undefined),
    [english],
  );

  if (waitingForEnglish) return null;
  return (
    <I18nProvider catalogs={catalogs} initialLocale={bootLocale} onMissingKey={reportMissingKey} ensureCatalog={ensureCatalog}>
      {children}
    </I18nProvider>
  );
}

export interface AppI18n extends Omit<I18nContextValue, "t"> {
  readonly t: (key: AppTranslationKey, params?: TranslationParams) => string;
}

/** The app's translator, narrowed to the keys this app actually ships so a typo is a type error. */
export function useAppTranslation(): AppI18n {
  return useTranslation() as AppI18n;
}
