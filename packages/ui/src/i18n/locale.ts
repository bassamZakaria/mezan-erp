export type Locale = "ar" | "en";
export type Direction = "rtl" | "ltr";

export const LOCALES: readonly Locale[] = ["ar", "en"];

export const DEFAULT_LOCALE: Locale = "ar";

const DIRECTION_BY_LOCALE: Record<Locale, Direction> = { ar: "rtl", en: "ltr" };

/** Direction is DERIVED from the locale — never stored, never passed in (docs/archive/plan.md §2.1). */
export function directionOf(locale: Locale): Direction {
  return DIRECTION_BY_LOCALE[locale];
}

export function isLocale(value: unknown): value is Locale {
  return value === "ar" || value === "en";
}

/** A language's own name, shown as-is in every locale — endonyms are not translated. */
export const LOCALE_ENDONYM: Record<Locale, string> = { ar: "العربية", en: "English" };

/** Compact switcher label. */
export const LOCALE_SHORT_LABEL: Record<Locale, string> = { ar: "ع", en: "EN" };
