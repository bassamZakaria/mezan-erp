import { isLocale, type Locale } from "./locale";

const LOCALE_STORAGE_KEY = "mezan.locale";

function getLocaleStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Privacy mode / disabled storage can throw on access rather than just being absent.
    return null;
  }
}

/** Restores the chosen interface language on load, so a refresh doesn't snap back to Arabic. */
export function loadPersistedLocale(): Locale | null {
  const storage = getLocaleStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persists the chosen interface language so it survives a page refresh. */
export function persistLocale(locale: Locale): void {
  const storage = getLocaleStorage();
  if (!storage) return;
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore write failures — the language still applies for this session.
  }
}
