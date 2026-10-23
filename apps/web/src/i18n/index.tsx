import {
  DEFAULT_LOCALE,
  ENGLISH_LOCALE,
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

let englishCatalog: TranslationCatalog | null = null;
let englishLoad: Promise<TranslationCatalog> | null = null;

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

const RELOADED_FOR_CATALOG = "mezan.reloadedForCatalog";

function reloadOnceForNewBuild(): void {
  try {
    if (sessionStorage.getItem(RELOADED_FOR_CATALOG)) return;
    sessionStorage.setItem(RELOADED_FOR_CATALOG, "1");
  } catch {
    return;
  }
  window.location.reload();
}

export function AppI18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [english, setEnglish] = useState(englishCatalog);
  const [bootLocale, setBootLocale] = useState<Locale>(() => initialLocale ?? loadPersistedLocale() ?? DEFAULT_LOCALE);
  const waitingForEnglish = bootLocale === ENGLISH_LOCALE && english === null;

  useEffect(() => {
    if (!waitingForEnglish) return;
    loadEnglishCatalog().then(setEnglish, () => {
      setBootLocale(DEFAULT_LOCALE);
      reloadOnceForNewBuild();
    });
  }, [waitingForEnglish]);

  const catalogs = useMemo(() => mergeCatalogs(uiCatalogs, { ar: webAr, en: english ?? {} }), [english]);
  const ensureCatalog = useCallback(
    (locale: Locale) =>
      locale === ENGLISH_LOCALE && english === null
        ? loadEnglishCatalog().then(setEnglish, (error: unknown) => {
            reloadOnceForNewBuild();
            throw error;
          })
        : undefined,
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
