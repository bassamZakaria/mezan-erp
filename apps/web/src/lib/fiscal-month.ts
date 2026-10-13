import type { AppTranslationKey } from "../i18n";

const MONTH_KEYS: readonly AppTranslationKey[] = [
  "month.january",
  "month.february",
  "month.march",
  "month.april",
  "month.may",
  "month.june",
  "month.july",
  "month.august",
  "month.september",
  "month.october",
  "month.november",
  "month.december",
];

export function fiscalMonthLabel(periodNumber: number, t: (key: AppTranslationKey) => string): string {
  const key = MONTH_KEYS[periodNumber - 1];
  return key ? t(key) : String(periodNumber);
}
