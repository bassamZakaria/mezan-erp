import { useEffect, useRef, type ReactNode } from "react";
import { NumeralsProvider, loadPersistedLocale, useTranslation } from "@mezan/ui";
import { useTenantSettings } from "../data/hooks";

/**
 * Applies the two عام settings that describe the interface itself.
 *
 * `dateNumerals` reaches every figure in the app through the formatter's
 * context, and `language` is the tenant's DEFAULT: it is applied only when this
 * browser has no language of its own, so an individual user's choice of English
 * on a shared Arabic install is never overwritten on the next page load.
 */
export function TenantPreferences({ children }: { children: ReactNode }) {
  const settings = useTenantSettings();
  const { setLocale } = useTranslation();
  const applied = useRef(false);
  const language = settings.data?.language;

  useEffect(() => {
    if (applied.current || !language || language === "de") return;
    applied.current = true;
    if (loadPersistedLocale() === null) setLocale(language);
  }, [language, setLocale]);

  return <NumeralsProvider numerals={settings.data?.dateNumerals ?? "western"}>{children}</NumeralsProvider>;
}
