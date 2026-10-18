import { useCallback } from "react";
import { useFormat } from "@mezan/ui";
import { ArabicCase, countPhrase, type CountedNoun } from "@mezan/domain";
import { useAppTranslation } from "../i18n";

export type CountPhrase = (count: number, noun: CountedNoun, grammaticalCase?: ArabicCase) => string;

export function useCountPhrase(): CountPhrase {
  const { locale } = useAppTranslation();
  const { number } = useFormat();
  return useCallback(
    (count, noun, grammaticalCase = ArabicCase.Nominative) => countPhrase(locale, count, noun, { grammaticalCase, formatNumber: number }),
    [locale, number],
  );
}
