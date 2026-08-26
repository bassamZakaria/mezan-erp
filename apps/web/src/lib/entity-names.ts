import { useCallback } from "react";
import { useAppTranslation } from "../i18n";

/**
 * A tenant record that stores its own name in both languages. Most carry
 * `nameAr`; treasury accounts, branches and warehouses call the Arabic one
 * plain `name`, so both spellings are accepted rather than renaming columns
 * that the wire contract and the seed already agree on.
 */
type NamedRecord = {
  readonly nameAr?: string;
  readonly name?: string;
  readonly nameEn?: string | null;
};

/**
 * Picks the right language out of a tenant record that stores both names.
 *
 * The sibling of `useDomainLabels`, for rows the TENANT owns rather than ones a
 * domain package ships: accounts, units, categories, brands, seasons,
 * specifications, treasury accounts. Reading the Arabic name directly is how
 * Arabic leaked into the English UI on the chart of accounts, the dashboard's
 * expense split and every item and treasury picker (D46, D49, D51).
 *
 * An English name that was never filled in falls back to the Arabic one: a
 * blank is worse than the wrong language, because the row stops being findable.
 */
export function entityName(record: NamedRecord | null | undefined, locale: string, fallback = ""): string {
  if (!record) return fallback;
  const ar = record.nameAr ?? record.name ?? "";
  if (locale !== "en") return ar || fallback;
  const en = record.nameEn?.trim();
  return en !== undefined && en !== "" ? en : ar || fallback;
}

export function useEntityName(): (record: NamedRecord | null | undefined, fallback?: string) => string {
  const { locale } = useAppTranslation();
  return useCallback((record: NamedRecord | null | undefined, fallback = "") => entityName(record, locale, fallback), [locale]);
}
