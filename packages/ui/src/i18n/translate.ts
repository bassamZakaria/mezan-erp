import { DEFAULT_LOCALE, type Locale } from "./locale";

export type TranslationCatalog = Readonly<Record<string, string>>;
export type LocaleCatalogs = Readonly<Record<Locale, TranslationCatalog>>;
export type TranslationParams = Readonly<Record<string, string | number>>;
export type Translate = (key: string, params?: TranslationParams) => string;
export type MissingKeyReporter = (key: string, locale: Locale) => void;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Replaces every `{name}` with `params.name`; an unmatched placeholder is left verbatim. */
export function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Last-resort text for a key that exists in NO catalog. The reference app leaks
 * raw keys like `customers.openingBalance` into its UI
 * (docs/reference-parity/) — this renders human words
 * instead so a typo degrades to readable text rather than developer noise.
 */
export function humanizeKey(key: string): string {
  const last = key.split(".").pop() ?? key;
  const words = last
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function mergeCatalogs(...catalogs: readonly LocaleCatalogs[]): LocaleCatalogs {
  return {
    ar: Object.assign({}, ...catalogs.map((c) => c.ar)) as TranslationCatalog,
    en: Object.assign({}, ...catalogs.map((c) => c.en)) as TranslationCatalog,
  };
}

/**
 * Resolves `key` in `locale`, falling back to the Arabic string when the active
 * locale has no entry (Arabic is the source language — a half-translated
 * locale renders Arabic, never a raw key).
 */
export function translate(
  catalogs: LocaleCatalogs,
  locale: Locale,
  key: string,
  params?: TranslationParams,
  onMissing?: MissingKeyReporter,
): string {
  const direct = catalogs[locale][key];
  if (direct !== undefined) return interpolate(direct, params);

  onMissing?.(key, locale);

  const fallback = catalogs[DEFAULT_LOCALE][key];
  if (fallback !== undefined) return interpolate(fallback, params);

  return interpolate(humanizeKey(key), params);
}
