import { useCallback } from "react";
import { useAppTranslation } from "../i18n";

/**
 * Picks the right language out of a domain catalog entry.
 *
 * Domain packages carry their own bilingual labels — voucher types, gateable
 * action types, adjustment reasons — because they are business vocabulary, not
 * UI copy, and the server uses them too. Reading `.labelAr` directly is how
 * Arabic leaks into the English UI, which it had in the voucher type picker,
 * the voucher list and the approvals inbox.
 */
export function useDomainLabels() {
  const { locale } = useAppTranslation();
  const label = useCallback(
    <T extends { readonly labelAr: string; readonly labelEn: string }>(entry: T): string =>
      locale === "en" ? entry.labelEn : entry.labelAr,
    [locale],
  );
  const subtitle = useCallback(
    <T extends { readonly subtitleAr: string; readonly subtitleEn: string }>(entry: T): string =>
      locale === "en" ? entry.subtitleEn : entry.subtitleAr,
    [locale],
  );
  return { label, subtitle };
}
