import {
  I18nProvider,
  mergeCatalogs,
  uiCatalogs,
  useTranslation,
  type I18nContextValue,
  type Locale,
  type TranslationParams,
  type UiTranslationKey,
} from "@mezan/ui";
import type { ReactNode } from "react";
import { webCatalogs, type WebTranslationKey } from "./catalog";

export type { Locale };
export type AppTranslationKey = WebTranslationKey | UiTranslationKey;

/** Everything the running app can render: the shared `@mezan/ui` strings plus the web app's own. */
const appCatalogs = mergeCatalogs(uiCatalogs, webCatalogs);

function reportMissingKey(key: string, locale: Locale): void {
  if (!import.meta.env.DEV) return;
  console.error(`[i18n] missing "${locale}" translation for key "${key}" — falling back to Arabic.`);
}

/** Wraps the app in the locale context; `dir`/`lang` on <html> follow from it. */
export function AppI18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  return (
    <I18nProvider catalogs={appCatalogs} initialLocale={initialLocale} onMissingKey={reportMissingKey}>
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
