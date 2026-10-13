import { getLocales } from "expo-localization";
import { Locale, STRINGS, type Strings } from "./strings";

export { Locale, WaitUnit } from "./strings";
export type { Strings, WaitForms } from "./strings";

/** Arabic is the default and the fallback: this is an Arabic-first product, not an English one with a translation. */
export function activeLocale(): Locale {
  const tag = getLocales()[0]?.languageCode;
  return tag === Locale.En ? Locale.En : Locale.Ar;
}

export function useStrings(): Strings {
  return STRINGS[activeLocale()];
}
